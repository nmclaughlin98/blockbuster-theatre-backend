# Booking Data API

Movie imports apply optional, per-TMDB-ID metadata overrides from `src/main/lambda/handlers/movie-metadata-overrides.ts`. The registry currently includes Star Wars title, slug, and ordering overrides; add entries there to support other franchises or collections without changing the import handler. Imported records expose `sortTitle` (falling back to the display title when no custom order is configured). Existing records are not backfilled automatically; re-import their TMDB IDs through `POST /movies` to apply overrides. The `/movies` pagination order remains based on release date and is unchanged.

Movie records store TMDB `poster` and `still` URLs at original resolution. To backfill existing movie records, set `MOVIE_TABLE_NAME` and AWS credentials/region, then run `npm run migrate:movie-image-urls` to preview changes. The script scans every page and updates only those two URL attributes while preserving the rest of each record. Add `-- --apply` to write the changes after reviewing the dry-run output:

```powershell
$env:MOVIE_TABLE_NAME = "blockbuster-theatre-movie-catalogue"
$env:AWS_PROFILE = "your-aws-profile"
$env:AWS_REGION = "eu-west-2"
npm run migrate:movie-image-urls
npm run migrate:movie-image-urls -- --apply
```

The bulk upsert endpoints use the same JWT authorizer as the existing movie administration POST endpoint. Each request accepts 1–25 complete records in the matching array property. Submitted IDs are replaced atomically; records not included in the request are unchanged. Duplicate IDs in one request are rejected.

## Movie collections

TMDB lists are the source of truth for collections. Each collection record stores the TMDB list name, description, poster URL, backdrop URL, and every movie ID in the list. The IDs are stored even if those movies have not been imported into the movie catalogue yet. Movie records do not store collection membership.

List all stored collections with the public endpoint:

`GET /collections`

The response contains collection summaries sorted by name. Each summary includes `collectionId`, `name`, `description`, `posterUrl`, `backdropUrl`, `movieCount`, and `lastUpdated` when available. Movie IDs are omitted; request a collection by ID to retrieve its full details.

```json
{
  "collections": [
    {
      "collectionId": "8706524",
      "name": "Marvel Cinematic Universe",
      "description": "An interconnected film series.",
      "posterUrl": "",
      "backdropUrl": "",
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

`GET /collections/{id}` returns the list metadata, the complete `movieIds` array, and movie summaries for IDs that currently exist in the catalogue. When a missing movie is later added through `POST /movies`, it appears in this response automatically because membership is resolved from the list's IDs at read time.

Example collection portion of the response:

```json
{
  "collection": {
    "collectionId": "8706524",
    "name": "Marvel Cinematic Universe",
    "description": "An interconnected film series.",
    "posterUrl": "",
    "backdropUrl": "",
    "movieIds": ["1726", "1724", "999"]
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

`GET /film-selections` returns visible movies and active offers for booking. Offer entries retain the DynamoDB display attributes used by the website:

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
        "Tuesday": ["11:00"]
      }
    }
  ]
}
```

`featuredMovieId` is the movie's numeric ID represented as a string. `overrideShowtimes` and `displayLabel` are optional. Omit `overrideShowtimes` to use the featured movie's schedule; when provided, its weekday/time map is used for the offer.

Successful requests return the number of upserted records and their IDs. Invalid input returns HTTP 400; DynamoDB failures return HTTP 500 with a request ID for log lookup.

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

To run the same local HTTP adapter and Lambda handlers against existing AWS DynamoDB dev/test tables, configure AWS credentials and all three table names before starting the cloud mode. The names must end in `-dev`, `-test`, `-testing`, `-staging`, or `-sandbox`; this guard prevents accidentally targeting the production table names. Cloud mode does not start or initialize DynamoDB Local and does not create AWS resources.

```powershell
$env:AWS_PROFILE = "your-aws-profile"
$env:AWS_REGION = "eu-west-2"
$env:LOCAL_CLOUD_TABLE_NAME = "blockbuster-theatre-movie-catalogue-dev"
$env:LOCAL_CLOUD_PRICING_TABLE_NAME = "blockbuster-theatre-ticket-pricing-dev"
$env:LOCAL_CLOUD_OFFERS_TABLE_NAME = "blockbuster-theatre-booking-offers-dev"
$env:LOCAL_CLOUD_COLLECTIONS_TABLE_NAME = "blockbuster-theatre-movie-collections-dev"
npm run local:cloud
```

The profile must have DynamoDB permissions for those tables. The tables must already exist with the same keys and movie-table `GSI1` as the application tables. Existing cloud dev/test data is used directly; this command does not seed or copy data. Local `POST /ticket-pricing`, `POST /booking-offers`, and `POST /collections/refresh` requests write to those cloud tables, so do not point this mode at production. The local adapter still bypasses API Gateway JWT authentication and remains loopback-only.
