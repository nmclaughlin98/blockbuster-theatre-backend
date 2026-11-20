# Booking Data API

> Do not deploy or run migration scripts against existing production resources. The new stacks require validation and live collision checks.

## Movie catalogue

`GET /api/v1/movies` returns movie summaries in descending release-date index order. Records with `visible: false` are excluded; legacy records without `visible` are included with `visible: true`. All existing summary fields are retained.

Without a `limit`, the endpoint combines DynamoDB pages, up to 20 queries or a 4 MiB serialized Lambda proxy response budget. It returns `{ "movies": [...], "nextToken": null }` when complete; otherwise, pass `nextToken` to retrieve the remainder. An explicit `limit` (1–100) retains the existing per-DynamoDB-query pagination behavior, so a page may contain fewer visible movies than requested. Clients must follow non-null tokens.

## Lambda logging

All Lambda functions use CloudWatch Logs with a seven-day retention period and the standard Lambda execution permissions for writing logs. API responses are logged by status only: successful responses at `INFO`, client errors at `WARN`, and server errors at `ERROR`; response bodies are not included. Guest booking logs request start and successful booking creation without logging guest details. Guest booking and booking confirmation also temporarily log the resolved maximum-ticket value and whether it came from Parameter Store or the fallback.

## API Gateway access logging

The HTTP API default stage writes access logs to CloudWatch Logs in `eu-west-2`: `/aws/vendedlogs/blockbuster-theatre-api-access-PROD` for prod and `/aws/vendedlogs/blockbuster-theatre-api-access-DEV` for dev. Logs are retained for seven days. The prod log group is retained if its stack is deleted; the dev log group is deleted with its stack.

Logs include the request ID, time, method, route key, response status and latency, integration status, and available gateway or authorizer errors. They do not explicitly include request bodies, authorization headers, tokens, query strings, or JWT claims. An authorizer error may not contain the reason for every JWT rejection. Logs begin after deployment and access logging can incur CloudWatch charges. The deploying role needs the permissions listed in the [AWS HTTP API logging documentation](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-logging.html#http-api-logging.permissions).

## Public featured movie endpoints

`GET /api/v1/movies?sort=newest` returns movies ordered by release date, newest first, excluding records where `isComingSoon` is `true`. Legacy records without an `isComingSoon` field are included.

`GET /api/v1/movies?sort=top-picks` returns movies ordered by TMDB score (`score`) from highest to lowest. This endpoint does not filter coming-soon records.

Both endpoints are public and accept `limit` (1–100, default 50) and `nextToken` from the prior response. They return `{ "movies": [...], "nextToken": "..." }`, with `nextToken: null` when no additional page is available.

## Booking confirmation email

`POST /api/v1/bookings/{bookingId}/confirmation` sends confirmation using stored booking details. Supply the owner's JWT or the guest's `bookingRef` and `email` query parameters. The existing SES identity is referenced, not recreated. The reservation is unpaid.

The maximum accepted ticket count is read during booking creation from the environment-specific Systems Manager Parameter Store `max-tickets-value` parameter. If it is not configured or does not exist, the existing service uses a limit of 10.

Movie imports apply optional per-TMDB-ID metadata overrides from `src/main/lambda/handlers/utils/movie-metadata-overrides.ts`. Imported records expose `sortTitle` (falling back to the display title when no custom order is configured). Existing records are not backfilled automatically; re-import their TMDB IDs through `POST /api/v1/movies` to apply overrides.

Movie records store TMDB `poster` and `still` URLs at original resolution. To backfill existing movie records, set `MOVIE_TABLE_NAME` and AWS credentials/region, then run `npm run migrate:movie-image-urls` to preview changes. The script scans every page and updates only those two URL attributes while preserving the rest of each record. Add `-- --apply` to write the changes after reviewing the dry-run output:

```powershell
$env:MOVIE_TABLE_NAME = "blockbuster-theatre-movies-table-DEV"
$env:AWS_PROFILE = "your-aws-profile"
$env:AWS_REGION = "eu-west-2"
npm run migrate:movie-image-urls
npm run migrate:movie-image-urls -- --apply
```

## Cinema screening schedule

Movie catalogue records no longer use `showtimes` as their schedule source. They store `startDate`, optional `runEndDate`, and `preSalesEligible`; scheduled screenings live in the new environment-specific showtime registry. The new movie table is keyed by `movieId`.

`POST /api/v1/movies` accepts optional `startDate`, `runEndDate`, and `preSalesEligible` fields alongside `movieIds`. `startDate` defaults to the future release date, or today for a movie already released. A future release is reported as `Coming Soon (Pre-Sales Open)` only when pre-sales are enabled and at least one upcoming screening exists; otherwise it is `Coming Soon (No Showtimes Yet)`. Released movies are `Now Showing` until after `runEndDate`, when they become `Ended`.

`GET /api/v1/movies/{movieId}` reads active screenings from the showtime registry for the requested date, or today through the end of the current week plus five days; it does not create or modify screenings and does not access booking records. The EventBridge-triggered scheduler maintains this rolling window every six hours. It uses the existing age/score frequency rules, allows at most four screenings per movie per day, and reserves a 45-minute turnaround/trailer buffer on each screen. Manually managed and offer screenings are retained; stale past screening records are removed only when no active seat locks remain. A run end date prevents new screenings beyond that date while preserving booked screenings.

JWT-protected manual screening routes use the movie ID as a query parameter:

- `POST /api/v1/showtimes?movieId=456` with `{ "date": "2026-12-20", "screen": "2", "time": "19:00" }` creates a screening.
- `PATCH /api/v1/showtimes/{showtimeId}?movieId=456` updates one or more of `date`, `screen`, and `time`.
- `DELETE /api/v1/showtimes/{showtimeId}?movieId=456` cancels a screening.

Manual changes respect the run dates, four-screening daily cap, screen conflicts, and turnaround buffer. A screening with active bookings cannot be changed or cancelled; these requests return `409`.

### Scheduling data migrations

After deploying the `ShowtimesByDate` index, backfill existing registry records before relying on date-based schedule queries:

```powershell
$env:SHOWTIME_REGISTRY_TABLE_NAME = "blockbuster-theatre-showtime-registry"
$env:AWS_PROFILE = "your-aws-profile"
$env:AWS_REGION = "eu-west-2"
npm run migrate:showtime-registry
npm run migrate:showtime-registry -- --apply
```

Legacy movie `showtimes` values are ignored by the new scheduler. Preview them before removal:

```powershell
$env:MOVIE_TABLE_NAME = "blockbuster-theatre-movies-table-DEV"
$env:AWS_PROFILE = "your-aws-profile"
$env:AWS_REGION = "eu-west-2"
npm run migrate:movie-showtimes
```

The legacy values may contain manually customized weekly schedules. Recreate any desired screenings with the manual API before removal; the migration requires an explicit confirmation flag:

```powershell
npm run migrate:movie-showtimes -- --apply --confirm-overrides-reviewed
```

Offer overrides are stored separately and continue to use screened showtime objects. Migrate legacy string-only offer overrides before deploying strict offer validation:

### Migrating existing offer overrides

Run this dry-run-first migration to assign a screen to each existing string-only offer override. It preserves every override day and time, skips offers without overrides, and leaves already-screened overrides unchanged. Run the preview and inspect it before applying:

```bash
export OFFERS_TABLE_NAME="blockbuster-theatre-booking-offers"
npm run update:offer-showtimes
npm run update:offer-showtimes -- --apply
```

Run `update:offer-showtimes` for legacy offer overrides. Movie schedules are now generated from rules and stored in the screening registry.

## Deprecated showtime format

The former string-only schedule format is deprecated and is no longer accepted for offer overrides. Requests using it are rejected:

```json
{
  "Monday": ["13:00", "14:20"]
}
```

Use screened showtime objects for offer overrides. Movie schedules are not written to movie records.

```json
{
  "Monday": [
    { "screen": "1", "time": "13:00" },
    { "screen": "3", "time": "14:20" }
  ]
}
```

The bulk upsert endpoints use the same JWT authorizer as the existing movie administration POST endpoint. Each request accepts 1–25 complete records in the matching array property. Submitted IDs are replaced atomically; records not included in the request are unchanged. Duplicate IDs in one request are rejected.

## Movie collections

TMDB lists are the source of truth for collections. Each collection record stores the TMDB list name, description, poster URL, backdrop URL, and every movie ID in the list. The IDs are stored even if those movies have not been imported into the movie catalogue yet. Movie records do not store collection membership.

List all stored collections with the public endpoint:

`GET /api/v1/collections`

The response contains collection summaries sorted by name. Each summary includes `collectionId`, `name`, `description`, `posterUrl`, `backdropUrl`, `movieCount`, `isActive`, and `lastUpdated` when available. `isActive` defaults to `true` for collections without a stored value. Movie IDs are omitted; request a collection by ID to retrieve its full details.

```json
{
  "collections": [
    {
      "collectionId": "8706524",
      "name": "Marvel Cinematic Universe",
      "description": "An interconnected film series.",
      "posterUrl": "",
      "backdropUrl": "",
      "isActive": true,
      "movieCount": 3
    }
  ]
}
```

The TMDB list ID is used as `collectionId`; movie IDs are stored as strings in the list's order. Non-movie list entries are excluded.

Refresh one or more collections from TMDB with the authenticated admin endpoint:

`POST /api/v1/collections/refresh`

Provide a non-empty `ids` array of positive TMDB list IDs as strings or numbers. Requests support up to 25 IDs and reject invalid or duplicate IDs before refreshing any lists.

```json
{
  "ids": ["8706524", "1234567"]
}
```

The response contains a result for each ID in request order. Each list is refreshed independently: successful records are replaced only after every TMDB page has been fetched, while failures are reported per ID. The endpoint returns HTTP 200 if all refreshes succeed or HTTP 207 if one or more fail. The Lambda uses the configured `TMDB_API_KEY`, retrieves every page from `/3/list/{id}?language=en-US&page={page}`, and converts poster and backdrop paths to TMDB `w500` and `w1280` URLs; when TMDB has no path, the URL is an empty string.

Example partial-success response:

```json
{
  "message": "One or more TMDB lists could not be refreshed.",
  "refreshedCount": 1,
  "failedCount": 1,
  "results": [
    {
      "collectionId": "8706524",
      "success": true,
      "name": "Marvel Cinematic Universe",
      "movieCount": 3,
      "lastUpdated": "2025-01-01T00:00:00.000Z"
    },
    {
      "collectionId": "1234567",
      "success": false,
      "statusCode": 404,
      "message": "TMDB list not found."
    }
  ]
}
```

Set `TMDB_API_KEY` in the environment used to synthesize/deploy the stack. For local API testing, set that same environment variable before starting the local API; the local refresh route also requires the local admin token.

`GET /api/v1/collections/{collectionId}` returns the list metadata, its `isActive` state (defaulting to `true` when not stored), the complete `movieIds` array, and movie summaries for IDs that currently exist in the catalogue. When a missing movie is later added through `POST /api/v1/movies`, it appears in this response automatically because membership is resolved from the list's IDs at read time.

Example collection portion of the response:

```json
{
  "collection": {
    "collectionId": "8706524",
    "name": "Marvel Cinematic Universe",
    "description": "An interconnected film series.",
    "posterUrl": "",
    "backdropUrl": "",
    "movieIds": ["1726", "1724", "999"],
    "isActive": true
  },
  "movies": []
}
```

## Upsert ticket pricing

`POST /api/v1/pricing`

```json
{
  "pricing": [
    {
      "pricingId": "KIDS_CLUB_RATES",
      "name": "Kids Club Rates",
      "currency": "GBP",
      "ticketTiers": [
        {
          "id": "child",
          "label": "Kids Club Child Ticket",
          "description": "Kids Club admission per child",
          "price": 2.5
        }
      ]
    }
  ]
}
```

`currency` must be `GBP`. Each tier needs a unique `id`, string `label` and `description`, and a non-negative price with no more than two decimal places.

Standard movie bookings automatically resolve to `CRAZY_TUESDAY_RATES` for every Tuesday showtime, regardless of time. Other weekday showtimes before 17:00 use `OFF_PEAK_RATES`; all remaining standard movie showtimes use `STANDARD_RATES`. Offer bookings always use the package referenced by that offer's `pricingId`.

The Crazy Tuesday package is configured as one £4 ticket tier:

```json
{
  "pricing": [
    {
      "pricingId": "CRAZY_TUESDAY_RATES",
      "name": "Crazy Tuesday Rates",
      "currency": "GBP",
      "ticketTiers": [
        {
          "id": "crazy-tuesday",
          "label": "Crazy Tuesday Ticket",
          "description": "Admission for any Tuesday movie showing",
          "price": 4
        }
      ]
    }
  ]
}
```

## Film selections

`GET /api/v1/checkout/current-selections` returns visible movies that are not coming soon, along with active offers for booking. Offer entries retain the DynamoDB display attributes used by the website:

```json
{
  "type": "offer",
  "id": "halloween-spooktacular",
  "offerId": "halloween-spooktacular",
  "title": "Halloween Spooktacular",
  "label": "Halloween Spooktacular",
  "displayLabel": "Halloween Spooktacular",
  "tagline": "Through the month of October",
  "priceDescription": "£2.50 with valid Student ID",
  "ctaLabel": "Claim Offer",
  "featuredMovieId": "27850",
  "pricingId": "STANDARD_RATES",
  "overrideShowtimes": {}
}
```

`id` and `label` are selection fields used by the booking flow; offer display attributes keep their DynamoDB names.

## Upsert booking offers

`POST /api/v1/offers`

```json
{
  "offers": [
    {
      "offerId": "kids-club",
      "title": "Kids Club",
      "tagline": "Every Tuesday",
      "priceDescription": "£2.50 per child",
      "ctaLabel": "Claim Offer",
      "featuredMovieId": "456",
      "pricingId": "KIDS_CLUB_RATES",
      "isActive": true,
      "displayLabel": "OFFER - Kids Club",
      "overrideShowtimes": {
        "Tuesday": [
          { "screen": "1", "time": "11:00" }
        ]
      }
    }
  ]
}
```

`featuredMovieId` is the movie's numeric ID represented as a string. `overrideShowtimes` and `displayLabel` are optional. Omit `overrideShowtimes` to use the featured movie's schedule; when provided, its weekday/time map is used for the offer.

Successful requests return the number of upserted records and their IDs. Invalid input returns HTTP 400; DynamoDB failures return HTTP 500 with a request ID for log lookup.

## Seat bookings

Each showtime in `GET /api/v1/movies/{movieId}` and `GET /api/v1/checkout/current-selections` has a stable, backend-resolvable `showtimeId`, alongside `screen` and `time`. Pass `?date=YYYY-MM-DD` for a specific occurrence. IDs use the format `NNNNNN_YYYY-MM-DD_HHmm`, for example `559924_2026-11-01_1215`. Offer override showtimes use the same registry and format.

Catalogue showtimes repeat weekly. Both schedule endpoints accept an optional `?date=YYYY-MM-DD` to return IDs for a specific occurrence; without it, the next occurrence date for each weekday is used. A booking also supplies the same calendar `date` in `YYYY-MM-DD` format. The date must be valid, match the date embedded in `showtimeId`, and must not be in the past in UK time. Up to 10 unique seats may be selected per booking; IDs are a row letter `A`-`G` plus a seat number `1`-`11`.

### Get booked seats for a showing

`GET /api/v1/bookings?showtimeId=559924_2026-11-01_1215`

```json
{
  "showtimeId": "559924_2026-11-01_1215",
  "date": "2026-11-01",
  "bookedSeats": ["F10", "F11"]
}
```

The lookup uses the same `showtimeId` and date identity as the guest booking endpoint. Invalid or unknown IDs and dates return HTTP 400; storage errors return HTTP 500.

Signed-in customers can supply a Cognito token on the same route. It returns the same `bookedSeats` list plus `myBookedSeats`, containing only the seats associated with the authenticated Cognito subject:

```json
{
  "showtimeId": "559924_2026-11-01_1215",
  "date": "2026-11-01",
  "bookedSeats": ["F10", "F11"],
  "myBookedSeats": ["F10"]
}
```

The route does not return booking details or other customers' identities.

### Make an unpaid guest booking

`POST /api/v1/bookings`

```json
{
  "showtimeId": "559924_2026-11-01_1215",
  "date": "2026-11-01",
  "seats": ["F10", "F11"],
  "email": "customer@example.com",
  "customerName": "Niall McLaughlin",
  "tickets": [
    { "tierId": "adult", "quantity": 1 },
    { "tierId": "child", "quantity": 1 }
  ]
}
```

`tickets` is required so the backend can validate the selected tiers, ensure ticket quantity equals the seat count, and calculate the authoritative amount using the existing pricing rules. For offer showtimes, include `offerId` as well. No `userId`, cart, guest-session token, or `paymentToken` is required or processed; do not send payment or card details. The request is unpaid and does not create a payment.

Success returns HTTP 201:

```json
{
  "bookingId": "bk_990123",
  "bookingRef": "BBT-883214",
  "movieId": "424694",
  "showtimeId": "559924_2026-11-01_1215",
  "movieTitle": "Bohemian Rhapsody",
  "date": "2026-11-01",
  "seats": ["F10", "F11"],
  "tickets": [
    { "tierId": "adult", "label": "Standard Adult", "quantity": 1, "unitPrice": 9.5, "subtotal": 9.5 },
    { "tierId": "child", "label": "Child Ticket", "quantity": 1, "unitPrice": 6, "subtotal": 6 }
  ],
  "totalAmount": 15.5,
  "currency": "GBP",
  "customerEmail": "customer@example.com",
  "conversionToken": "cnv_tok_<opaque-random-token>",
  "conversionTokenExpiresAt": "2026-10-26T12:15:00.000Z",
  "confirmationEmailSent": true
}
```

The endpoint returns HTTP 201. The email contains the separate `bookingRef` as the existing QR-code value; this reference is not the `showtimeId`. If email delivery fails after the reservation is committed, the endpoint still returns HTTP 201 with `confirmationEmailSent: false`.

Invalid guest details, seats, ticket tiers, date, or showtime return HTTP 400. Unknown movies or offers return HTTP 404. If a requested seat is no longer available, the transaction reserves none of the seats and returns HTTP 409. Unexpected storage or pricing failures return HTTP 500.

The new booking table uses `PK` and `SK`: booking metadata is `BOOKING#{bookingId}` / `METADATA`, seat locks are `SHOWTIME#{showtimeId}` / `SEAT#{seat}`, and reference locks are `REFERENCE#{bookingRef}` / `METADATA`. A conditional transaction reserves them together. Existing production tables are not accessed or migrated. The conversion token is randomly generated, stored only as a SHA-256 hash, expires after 24 hours, and can only be consumed once.

### Make an unpaid booking associated with an account

`POST /api/v1/bookings` accepts a Cognito token in the `Authorization: Bearer <token>` header. Send the same booking body as the guest endpoint. The handler verifies the token and stores the Cognito `sub` as the booking's `userId`; any `userId` included in the request body is rejected. Account bookings do not create a guest conversion token.

The endpoint returns the same booking details as the guest endpoint, except for `conversionToken` and `conversionTokenExpiresAt`.

### List account bookings

`GET /api/v1/bookings?status=upcoming` or `?status=past` requires a Cognito token in the `Authorization: Bearer <token>` header. Send an ID token to enable automatic guest-booking linking: only an ID token with `email_verified: true` and an email can initiate the sweep. Access tokens and unverified emails still return account history but do not initiate linking. Guest checkout does not check whether an account exists.

Automatic linking is disabled by default. It runs only when the environment's SSM String parameter is `true`: `/blockbuster-theatre/parameter-configurations/ALLOW_LINK_BOOKINGS` in production or `/blockbuster-theatre/parameter-configurations-dev/ALLOW_LINK_BOOKINGS` in development. A missing parameter also disables linking. Values must be `true` or `false` (case-insensitive); invalid values or other SSM errors fail the history request. The parameter is read on each eligible history request and is not created by this stack.

The sweep matches normalized `customerEmail` against the new table's `CustomerEmailBookings` index. It conditionally assigns only unowned upcoming bookings to the verified subject, sets `claimedAt` and `claimMethod`, and removes the guest conversion-token hash. A competing conversion or claim cannot overwrite the owner. Indexes are eventually consistent, so a recently created guest booking may be discovered on a later fetch. Newly claimed bookings are included immediately in the claiming response even before the `UserBookings` index catches up.

`newlyLinkedBookings` contains booking references claimed by this request and is empty on subsequent requests. One consolidated SES email is attempted for each nonempty sweep. Delivery is best effort: if SES fails, the response includes `linkNotificationSent: false`, the failure is logged, and no retry is scheduled. A request interrupted after committing a claim may not deliver its one-time response metadata to the browser. Account history and ticket availability otherwise remain subject to `UserBookings` index propagation.

```json
{
  "newlyLinkedBookings": [],
  "bookings": [
    {
      "bookingId": "bk_990123",
      "bookingRef": "BBT-883214",
      "movieId": "424694",
      "movieTitle": "Bohemian Rhapsody",
      "date": "2026-11-01",
      "time": "12:15",
      "screen": "5",
      "seats": ["F10", "F11"],
      "guestName": "Alex Smith",
      "ticketCount": 2,
      "totalAmount": 15.5,
      "currency": "GBP"
    }
  ]
}
```

The status filter uses the theatre's Europe/London time zone. Unlinked guest bookings are not included. `guestName` is the name stored on the booking.

### Download an account booking ticket

`GET /api/v1/bookings/{bookingId}/ticket` returns a PDF to the owner or to an unlinked guest supplying `bookingRef` and `email`. Missing or unauthorized bookings return 404.

The PDF represents an unpaid reservation; this endpoint does not process payment or validate admission.

### Convert a guest booking to an account

`POST /api/v1/auth/convert-guest-bookings`

```json
{
  "conversionToken": "cnv_tok_<opaque-random-token>",
  "password": "SuperSecretPassword123!",
  "firstName": "Niall",
  "surname": "McLaughlin"
}
```

The first name and surname must match the name on the guest booking and are saved as the Cognito `given_name` and `family_name` attributes. Older clients may omit both name fields; the service will derive them from the guest booking. The password is set and hashed by the existing Cognito user pool; it is never stored or logged by the application. On success, the one-time token is consumed, the booking is associated with the Cognito user ID, and the endpoint returns HTTP 200:

```json
{
  "userId": "cognito-user-id",
  "email": "customer@example.com",
  "accessToken": "<cognito-access-token>",
  "refreshToken": "<cognito-refresh-token>"
}
```

Invalid request or password returns HTTP 400, an unknown token returns HTTP 404, an already-consumed token returns HTTP 409, an expired (24-hour) token returns HTTP 410, and unexpected Cognito or storage failures return HTTP 500. Passwords, conversion tokens, and Cognito tokens are not logged.

### Account creation date claim

The existing pre-token trigger source derives `member_since` from Cognito's `UserCreateDate` for ID tokens. Its live attachment has not been verified. This refactor does not rely on the claim.

### Retrieve a booking

Guests can use `GET /api/v1/bookings?bookingRef=BBT-123456&email=guest@example.com`. The owner can use `GET /api/v1/bookings/{bookingId}` with a JWT; an unlinked guest can use the same path with `bookingRef` and `email`. Unauthorized or missing bookings return 404.

### Reschedule a booking

`PATCH /api/v1/bookings/{bookingId}/reschedule`

This route requires a valid Cognito JWT. For now, any signed-in user can call it;
guest requests are not authorized.

```json
{
  "newShowtimeId": "559924_2026-11-05_1930"
}
```

The target must be an existing active showtime and differ from the current one. Movie and screening details come from the target showtime and catalogue, not the request. A transaction updates metadata and moves all seat locks; the reference and conversion token remain associated with the same booking ID. The booking ID, reference, seats, and price are preserved. A conflicting change or unavailable seat returns HTTP 409 without moving the booking; missing bookings or showtimes return HTTP 404 and invalid input returns HTTP 400.

## Run the booking API locally

Requirements: Node.js 24 or newer and Docker with Compose.

Start DynamoDB Local, create local-only tables, seed the demo movie and any missing default pricing packages, then start an HTTP adapter for the booking handlers:

```powershell
npm run local
```

The API listens only on `http://127.0.0.1:3000`. DynamoDB uses local table names ending in `-local`. The demo movie ID is `99999999` and no offers are seeded. Add offers through `POST /api/v1/offers` using the local admin token (`local-dev-token` by default). Cognito verification, SSM, and SES still use AWS when those paths are exercised.

Try:

```powershell
curl.exe "http://127.0.0.1:3000/health"
curl.exe "http://127.0.0.1:3000/api/v1/checkout/current-selections"
curl.exe "http://127.0.0.1:3000/api/v1/pricing?movieId=99999999&day=Tuesday&time=19%3A00"
```

The local admin endpoints require `Authorization: Bearer local-dev-token` by default; set `LOCAL_ADMIN_TOKEN` before starting the API to use a different local token. The local adapter bypasses API Gateway's JWT authorizer, but optional-auth handlers still verify real Cognito tokens using `USER_POOL_ID`, `USER_POOL_CLIENT_ID`, and `POSTMAN_CLIENT_ID`. It binds to loopback only and must not be exposed publicly. Stop DynamoDB Local with `npm run local:db:stop`; its Docker volume preserves local data.

### Use local handlers with cloud DynamoDB dev/test tables

To run the same local HTTP adapter and Lambda handlers against existing AWS DynamoDB dev/test tables, configure AWS credentials and all seven table names before starting the cloud mode. The names must end in `-DEV`, `-development`, `-test`, `-testing`, `-staging`, or `-sandbox` (case-insensitive). Cloud mode does not start or initialize DynamoDB Local and does not create AWS resources.

```powershell
$env:AWS_PROFILE = "your-aws-profile"
$env:AWS_REGION = "eu-west-2"
$env:LOCAL_CLOUD_TABLE_NAME = "blockbuster-theatre-movies-table-DEV"
$env:LOCAL_CLOUD_PRICING_TABLE_NAME = "blockbuster-theatre-pricing-table-DEV"
$env:LOCAL_CLOUD_OFFERS_TABLE_NAME = "blockbuster-theatre-offers-table-DEV"
$env:LOCAL_CLOUD_COLLECTIONS_TABLE_NAME = "blockbuster-theatre-collections-table-DEV"
$env:LOCAL_CLOUD_BOOKINGS_TABLE_NAME = "blockbuster-theatre-bookings-table-DEV"
$env:LOCAL_CLOUD_SHOWTIME_REGISTRY_TABLE_NAME = "blockbuster-theatre-showtimes-table-DEV"
$env:LOCAL_CLOUD_GUEST_CONVERSION_TOKENS_TABLE_NAME = "blockbuster-theatre-guest-conversion-tokens-table-DEV"
$env:LOCAL_CLOUD_USER_POOL_ID = "eu-west-2_example"
$env:LOCAL_CLOUD_USER_POOL_CLIENT_ID = "exampleclientid"
$env:LOCAL_CLOUD_POSTMAN_CLIENT_ID = "examplepostmanclientid"
npm run local:cloud
```

The profile must have DynamoDB permissions for those tables and Cognito admin permissions on the specified pool to convert guest accounts. The tables must already exist with the Phase 1 keys and indexes. Existing dev/test data is used directly; this command does not seed or copy data. The local adapter bypasses API Gateway JWT authentication and remains loopback-only.

## Prod and dev AWS environments

The CDK entry point is `lib/stack/app.ts`. The environment defaults to `prod`; use `-c env=dev` to synthesize or deploy the isolated dev stack. Any other environment value is rejected.
Set the `TMDB_API_KEY` environment variable to a non-empty TMDB read access token before synthesizing. The template contains a masked CloudFormation parameter rather than the token itself. For a direct deployment, pass the same value as `--parameters TmdbApiKey=<token>` through a secure shell; command-line arguments may be visible to local processes. The first deployment with this change requires the parameter for both environments.

```powershell
npx cdk synth -c env=prod
npx cdk synth -c env=dev
```

The new stack IDs are `BlockbusterTheatreBackendStack-PROD` and `BlockbusterTheatreBackendStack-DEV`. Tables start empty; no migration is planned. The existing production stack remains untouched and owns shared resources, including the Cognito trigger. Importing references does not make it safe to delete. Neither new stack creates a domain mapping. Prod tables use `RETAIN`; dev tables use `DESTROY`.

CDK applies `Environment=prod` or `Environment=dev` and `Project=blockbuster-theatre` to supported stack-managed resources. Adding the prod environment tag changes the prod template; imported resources and resource types without tag support cannot be tagged by this stack.

The existing API domain mapping is not changed. Any future cutover needs explicit approval and live ownership and change-set review.

### Shared Cognito and SES resources

Dev imports the existing prod User Pool, backend App Client, and SES email identity; it does not create or modify Cognito pools/clients or an SES identity. The dev JWT authorizer accepts tokens issued to either the backend or the existing Postman app client. As in prod, both clients are accepted on all JWT-protected routes, not only movie administration.

The pool and frontend client IDs can be provided through CDK context (`prodUserPoolId`, `prodUserPoolClientId`) or environment variables (`PROD_USER_POOL_ID`, `PROD_USER_POOL_CLIENT_ID`). Otherwise the template requires `ProdUserPoolId` and `ProdUserPoolClientId` CloudFormation parameters.

For the Postman client, configure `PROD_POSTMAN_CLIENT_ID` or CDK context `prodPostmanClientId`; otherwise the template requires `ProdPostmanClientId`. Both deployment environments require all three shared Cognito IDs.

The dev API accepts the production frontend origin, local development origins, and HTTPS Cloudflare Pages previews. API Gateway HTTP API's `https://*` origin pattern is used for preview hostnames; it permits any HTTPS origin, so bearer-token handling must remain explicit and API authorization must not rely on CORS alone. `Authorization`, `Content-Type`, and common AWS/request headers are allowed.

Guest conversion tokens and booking records are read from the environment-specific DynamoDB tables. As requested, dev may create/authenticate an account in the shared prod Cognito pool when converting a dev guest booking; it only operates on the dev booking/token records.

The dev booking Lambdas also use the existing prod SES identity. Exercise email-sending flows carefully; dev traffic can send real email from the shared identity.

### Production data sync to dev

The legacy sync script and workflow have not been adapted to the new schema. Do not run them as part of this phase; no migration or production data copy is authorized.

### GitHub Actions deployments

The build workflow synthesizes `prod` for `main` and `dev` for `dev`. The deploy workflow deploys a successful `main` push build to prod and a successful `dev` push build to dev. Manual dispatch accepts `target_env` (`auto`, `prod`, or `dev`); `auto` selects prod for `main` and dev otherwise. The existing `environment` input remains available for older callers when `target_env` is `auto`. The deploy job uses the matching GitHub Environment.

The deploy job is disabled during this refactor. Both GitHub Environments need `PROD_USER_POOL_ID`, `PROD_USER_POOL_CLIENT_ID`, and `PROD_POSTMAN_CLIENT_ID` variables and a `TMDB_API_KEY` secret before any future approved deployment.

Build and preparation syntheses use a non-secret placeholder to validate the template without exposing the environment secret to the selected source or uploaded artifact. The deploy job validates the template and passes the real key as the masked `TmdbApiKey` CloudFormation parameter; older selected builds without this parameter are rejected. The deployed Lambda environment still contains the key, so restrict AWS Lambda and CloudFormation access appropriately.

By default, manual prod deployments must be run from `main` and select a successful `main` push build from this repository. The default-off `allow_non_main_prod` override allows dispatch from any branch and a numbered successful push build from any branch; with `latest`, it selects a successful push build from the branch selected when dispatching the workflow. The override deliberately bypasses the main-only protection and can deploy unreviewed code and infrastructure to production; use it only after reviewing the selected source. OIDC trust and IAM permissions may still prevent deployments from other branches. Manual dev deployments can select builds from other branches and synthesize the dev stack from that source. No release-tagging job exists in these workflows; any future SemVer tagging must remain restricted to `main`.

The repository's OIDC role is external to this codebase. Environment-bound jobs use subjects `repo:nmclaughlin98/blockbuster-theatre-backend:environment:prod` and `repo:nmclaughlin98/blockbuster-theatre-backend:environment:dev`; update trust as appropriate, with separate least-privilege roles where possible. Protect the GitHub Environments with deployment branch rules and reviewers: a workflow can otherwise use an approved environment to deploy code from an untrusted selected build. Dev deployment also needs permission to assume the CDK deploy role and read the prod stack's Cognito outputs.
