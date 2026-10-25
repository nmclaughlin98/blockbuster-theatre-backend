# Booking Data API

## Public featured movie endpoints

`GET /movies/newest` returns movies ordered by release date, newest first, excluding records where `isComingSoon` is `true`. Legacy records without an `isComingSoon` field are included.

`GET /movies/top-picks` returns movies ordered by TMDB score (`score`) from highest to lowest. This endpoint does not filter coming-soon records.

Both endpoints are public and accept the same optional pagination parameters as `GET /movies`: `limit` (1–100, default 50) and `nextToken` from the prior response. They return `{ "movies": [...], "nextToken": "..." }`, with `nextToken: null` when no additional page is available.

## Demo booking confirmation email

`POST /booking/confirmation` sends the guest a plain-text demo confirmation through Amazon SES. It does not process payment, create a reservation, or issue a valid cinema ticket. The email states this clearly.

```json
{
  "bookingRef": "BBT-123456",
  "customer": {
    "firstName": "Niall",
    "surname": "McLaughlin",
    "email": "guest@example.com",
    "phone": ""
  },
  "movieTitle": "A Movie",
  "date": "Tue 20 Oct 2026",
  "time": "19:00",
  "screen": "2",
  "seats": ["A1", "A2"],
  "tickets": 2,
  "totalPrice": 15.2
}
```

The stack creates an SES email identity for `niallmclaughlin1998@gmail.com`. After deployment, open the SES verification message sent to that mailbox and confirm the identity before sending. New SES accounts are commonly in the sandbox: recipients must also be verified until SES production access is granted in `eu-west-2`.

The endpoint is intended for the deployed demo booking flow and is not available through the local API adapter. It accepts the client-provided booking summary and does not persist or independently verify a booking or price. Do not treat the email as proof of payment or a confirmed seat reservation.

Movie imports apply optional, per-TMDB-ID metadata overrides from `src/main/lambda/handlers/movie-metadata-overrides.ts`. The registry currently includes Star Wars title, slug, and ordering overrides; add entries there to support other franchises or collections without changing the import handler. Imported records expose `sortTitle` (falling back to the display title when no custom order is configured). Existing records are not backfilled automatically; re-import their TMDB IDs through `POST /movies` to apply overrides. The `/movies` pagination order remains based on release date and is unchanged.

Movie records store TMDB `poster` and `still` URLs at original resolution. To backfill existing movie records, set `MOVIE_TABLE_NAME` and AWS credentials/region, then run `npm run migrate:movie-image-urls` to preview changes. The script scans every page and updates only those two URL attributes while preserving the rest of each record. Add `-- --apply` to write the changes after reviewing the dry-run output:

```powershell
$env:MOVIE_TABLE_NAME = "blockbuster-theatre-movie-catalogue"
$env:AWS_PROFILE = "your-aws-profile"
$env:AWS_REGION = "eu-west-2"
npm run migrate:movie-image-urls
npm run migrate:movie-image-urls -- --apply
```

Newly imported movies use the same shared schedule generator as the one-time updater. Every showing has a screen from 1 to 5. Movies released more than one year ago or with a score below 5/10 are scheduled on 60% of days, with 1–2 showtimes per scheduled day. Other movies are scheduled on 85% of days, with 2–4 showtimes per scheduled day. Schedules are repeatable per movie so the preview matches the applied update.

To replace every existing movie's showtimes, set the table name, AWS profile, and region, then preview the proposed schedules before applying them. The script updates only the `showtimes` attribute and follows the table's `tmdbId` and `slug` keys:

```json
{
  "Monday": [
    { "screen": "1", "time": "13:00" },
    { "screen": "3", "time": "14:20" }
  ]
}
```

Pricing requests still select a movie showtime by its day and time.

```powershell
$env:MOVIE_TABLE_NAME = "blockbuster-theatre-movie-catalogue"
$env:AWS_PROFILE = "your-aws-profile"
$env:AWS_REGION = "eu-west-2"
npm run update:movie-showtimes
npm run update:movie-showtimes -- --apply
```

On macOS or Linux, use Bash or Zsh `export` commands instead:

```bash
export MOVIE_TABLE_NAME="blockbuster-theatre-movie-catalogue"
export AWS_PROFILE="your-aws-profile"
export AWS_REGION="eu-west-2"
npm run update:movie-showtimes
npm run update:movie-showtimes -- --apply
```

### Migrating existing offer overrides

Run this dry-run-first migration to assign a screen to each existing string-only offer override. It preserves every override day and time, skips offers without overrides, and leaves already-screened overrides unchanged. Run the preview and inspect it before applying:

```bash
export OFFERS_TABLE_NAME="blockbuster-theatre-booking-offers"
npm run update:offer-showtimes
npm run update:offer-showtimes -- --apply
```

Run both the movie and offer migrations before deploying the strict showtime validation. Legacy records can otherwise cause `GET /movies`, `GET /film-selections`, or `GET /ticket-pricing` to reject the affected record.

## Deprecated showtime format

The former string-only schedule format is deprecated and is no longer accepted for movie schedules or offer overrides. Requests using it are rejected:

```json
{
  "Monday": ["13:00", "14:20"]
}
```

Use screened showtime objects instead. Existing cloud movie records must be migrated with `update:movie-showtimes`; offer overrides must be migrated with `update:offer-showtimes` before endpoints that read them can validate those records.

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

`GET /collections`

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

`POST /collections/refresh`

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

`GET /collections/{id}` returns the list metadata, its `isActive` state (defaulting to `true` when not stored), the complete `movieIds` array, and movie summaries for IDs that currently exist in the catalogue. When a missing movie is later added through `POST /movies`, it appears in this response automatically because membership is resolved from the list's IDs at read time.

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

`POST /ticket-pricing`

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

`GET /film-selections` returns visible movies that are not coming soon, along with active offers for booking. Offer entries retain the DynamoDB display attributes used by the website:

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

`POST /booking-offers`

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

Each showtime in `GET /movies/{movieId}` and `GET /film-selections` has a stable, backend-resolvable `showtimeId`, alongside `screen` and `time`. Pass `?date=YYYY-MM-DD` to either endpoint for IDs for a specific occurrence, for example `GET /movies/456?date=2026-11-01` or `GET /film-selections?date=2026-11-01`. IDs use the format `NNNNNN_YYYY-MM-DD_HHmm`, for example `559924_2026-11-01_1215` for a 12:15 screening. The random six-digit prefix is generated once and persisted by the backend for that dated screening, so the same screening has the same ID across requests. Offer override showtimes use the same registry and format.

Catalogue showtimes repeat weekly. Both schedule endpoints accept an optional `?date=YYYY-MM-DD` to return IDs for a specific occurrence; without it, the next occurrence date for each weekday is used. A booking also supplies the same calendar `date` in `YYYY-MM-DD` format. The date must be valid, match the date embedded in `showtimeId`, and must not be in the past in UK time. Up to 10 unique seats may be selected per booking; IDs are a row letter `A`-`G` plus a seat number `1`-`11`.

### Get booked seats for a showing

`GET /api/v1/bookings/guest?showtimeId=559924_2026-11-01_1215&date=2026-11-01`

```json
{
  "showtimeId": "559924_2026-11-01_1215",
  "date": "2026-11-01",
  "bookedSeats": ["F10", "F11"]
}
```

The lookup uses the same `showtimeId` and date identity as the guest booking endpoint. Invalid or unknown IDs and dates return HTTP 400; storage errors return HTTP 500.

### Make an unpaid guest booking

`POST /api/v1/bookings/guest`

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

The active booking table is keyed by `showtimeId` and `seatId`. It stores one booking record with the selected seat and ticket arrays; separate seat-lock records in the same table are reserved atomically with the booking and prevent double-booking. The previous `showingId` table is retained for compatibility and existing bookings are checked there before reserving seats. The conversion token is randomly generated, stored only as a SHA-256 hash, expires after 24 hours, and can only be consumed once.

### Convert a guest booking to an account

`POST /api/v1/auth/convert-guest`

```json
{
  "conversionToken": "cnv_tok_<opaque-random-token>",
  "password": "SuperSecretPassword123!"
}
```

The password is set and hashed by the existing Cognito user pool; it is never stored or logged by the application. On success, the one-time token is consumed, the booking is associated with the Cognito user ID, and the endpoint returns HTTP 200:

```json
{
  "userId": "cognito-user-id",
  "email": "customer@example.com",
  "accessToken": "<cognito-access-token>",
  "refreshToken": "<cognito-refresh-token>"
}
```

Invalid request or password returns HTTP 400, an unknown token returns HTTP 404, an already-consumed token returns HTTP 409, an expired (24-hour) token returns HTTP 410, and unexpected Cognito or storage failures return HTTP 500. Passwords, conversion tokens, and Cognito tokens are not logged.

### Existing booking endpoints

The existing `GET /bookings` and `POST /bookings` routes remain available for compatibility with the original booking model. New guest booking clients should use the versioned `/api/v1/bookings/guest` routes above so seat lookup and reservation share the same `showtimeId` and date.

### Get booked seats

`GET /bookings?movieId=456&date=2026-11-02&day=Monday&time=19:00`

```json
{
  "movieId": "456",
  "date": "2026-11-02",
  "showtime": { "day": "Monday", "screen": "3", "time": "19:00" },
  "bookedSeats": ["A1", "B4", "C2"]
}
```

Use `bookedSeats` to render booked seats in the seat map. Invalid query parameters return HTTP 400.

### Book seats

`POST /bookings`

```json
{
  "movieId": "456",
  "date": "2026-11-02",
  "showtime": { "day": "Monday", "time": "19:00" },
  "seats": ["B4", "B5"]
}
```

When the booking comes from an offer, also send `offerId` (with the offer's featured `movieId`); the offer's showtimes are then validated instead of the movie's. Otherwise the movie and showtime are validated against the catalogue. A successful request returns HTTP 201:

```json
{
  "bookingId": "6b0e5f3e-...",
  "userId": "2f9d0c7a-...",
  "movieId": "456",
  "movieTitle": "A Movie",
  "date": "2026-11-02",
  "showtimeId": "559924_2026-11-02_1900",
  "showtime": { "day": "Monday", "screen": "3", "time": "19:00" },
  "seats": ["B4", "B5"],
  "bookedAt": "2026-10-25T03:19:42.816Z"
}
```

Invalid seats, dates, or showtimes return HTTP 400, an unknown movie returns HTTP 404, and seats that were booked in the meantime return HTTP 409 (`Seat already booked: B5.`) without reserving any of the requested seats.

## Run the booking API locally

Requirements: Node.js 24 or newer and Docker with Compose.

Start DynamoDB Local, create local-only tables, seed the demo movie and any missing default pricing packages, then start an HTTP adapter for the booking handlers:

```powershell
npm run local
```

The API listens only on `http://127.0.0.1:3000`. It uses local table names ending in `-local`; it does not connect to AWS. The demo movie ID is `99999999` and no offers are seeded. Add offers through the local `POST /booking-offers` endpoint using the local admin token printed by the server (`local-dev-token` by default).

Try:

```powershell
curl.exe "http://127.0.0.1:3000/health"
curl.exe "http://127.0.0.1:3000/film-selections"
curl.exe "http://127.0.0.1:3000/ticket-pricing?movieId=99999999&day=Tuesday&time=19%3A00"
```

The local admin endpoints require `Authorization: Bearer local-dev-token` by default; set `LOCAL_ADMIN_TOKEN` before starting the API to use a different local token. The local adapter does not emulate API Gateway's JWT authorizer. It binds to loopback only and must not be exposed publicly. Stop DynamoDB Local with `npm run local:db:stop`; its Docker volume preserves local data.

### Use local handlers with cloud DynamoDB dev/test tables

To run the same local HTTP adapter and Lambda handlers against existing AWS DynamoDB dev/test tables, configure AWS credentials and all nine table names before starting the cloud mode. The names must end in `-dev`, `-test`, `-testing`, `-staging`, or `-sandbox`; this guard prevents accidentally targeting the production table names. Cloud mode does not start or initialize DynamoDB Local and does not create AWS resources.

```powershell
$env:AWS_PROFILE = "your-aws-profile"
$env:AWS_REGION = "eu-west-2"
$env:LOCAL_CLOUD_TABLE_NAME = "blockbuster-theatre-movie-catalogue-dev"
$env:LOCAL_CLOUD_PRICING_TABLE_NAME = "blockbuster-theatre-ticket-pricing-dev"
$env:LOCAL_CLOUD_OFFERS_TABLE_NAME = "blockbuster-theatre-booking-offers-dev"
$env:LOCAL_CLOUD_COLLECTIONS_TABLE_NAME = "blockbuster-theatre-movie-collections-dev"
$env:LOCAL_CLOUD_BOOKINGS_TABLE_NAME = "blockbuster-theatre-bookings-by-showtime-dev"
$env:LOCAL_CLOUD_LEGACY_BOOKINGS_TABLE_NAME = "blockbuster-theatre-bookings-dev"
$env:LOCAL_CLOUD_SHOWTIME_REGISTRY_TABLE_NAME = "blockbuster-theatre-showtime-registry-dev"
$env:LOCAL_CLOUD_BOOKING_REFERENCES_TABLE_NAME = "blockbuster-theatre-booking-references-dev"
$env:LOCAL_CLOUD_GUEST_CONVERSION_TOKENS_TABLE_NAME = "blockbuster-theatre-guest-conversion-tokens-dev"
$env:LOCAL_CLOUD_USER_POOL_ID = "eu-west-2_example"
$env:LOCAL_CLOUD_USER_POOL_CLIENT_ID = "exampleclientid"
npm run local:cloud
```

The profile must have DynamoDB permissions for those tables and Cognito admin permissions on the specified dev/test user pool to convert guest accounts. The tables must already exist with the same keys and movie-table `GSI1` as the application tables. Existing cloud dev/test data is used directly; this command does not seed or copy data. Local `POST /ticket-pricing`, `POST /booking-offers`, and `POST /collections/refresh` requests write to those cloud tables, so do not point this mode at production. The local adapter still bypasses API Gateway JWT authentication and remains loopback-only.
