# Booking Data API

The bulk upsert endpoints use the same JWT authorizer as the existing movie administration POST endpoint. Each request accepts 1–25 complete records in the matching array property. Submitted IDs are replaced atomically; records not included in the request are unchanged. Duplicate IDs in one request are rejected.

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
