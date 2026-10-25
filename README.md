# Blockbuster Theatre Backend

Backend API and AWS CDK infrastructure for the Blockbuster Theatre website. The API runs on AWS Lambda behind API Gateway and uses DynamoDB for movie catalogue, movie collections, ticket pricing, and booking offer data.

## Requirements

- Node.js 24 or newer
- npm
- Docker with Compose for the DynamoDB Local workflow
- AWS credentials and a configured region for cloud-backed local testing or deployment

## Getting started

Install dependencies and build the TypeScript project:

```bash
npm ci
npm run build
```

Run the test suite:

```bash
npm test
```

Synthesize the CDK stack without deploying it:

```bash
npm run synth
```

## API overview

The API supports:

- `GET /movies` and `GET /movies/{id}` for the movie catalogue. The list endpoint is paginated.
- `GET /collections/{id}` for a TMDB list and its movies currently in the catalogue.
- `GET /film-selections` for active movie and offer booking selections.
- `GET /ticket-pricing` for pricing resolved by movie or offer, weekday, and showtime.
- `POST /checkout/validate` to validate booking selections and calculate authoritative totals.
- `GET /bookings` to list booked seats for a showing, and `POST /bookings` to book seats (stored with a user ID, randomly generated until login exists).
- `GET /api/v1/bookings/guest` and `POST /api/v1/bookings/guest` for date-specific, unpaid guest bookings with backend-validated ticket totals.
- `POST /api/v1/auth/convert-guest` to convert a guest booking to a Cognito account using its one-time conversion token.
- `POST /booking/confirmation` to send a demo booking confirmation email through Amazon SES.
- `POST /collections/refresh` to refresh all pages for a batch of TMDB lists. Protected admin routes require the configured API Gateway JWT authorizer.

See [API_GUIDE.md](./API_GUIDE.md) for booking data examples and local API instructions.

## Local API testing

The local API adapter invokes the Lambda handlers without deploying them. It offers two database modes:

- `npm run local` starts DynamoDB Local, initializes local tables and fixtures, and runs the API at `http://127.0.0.1:3000`.
- `npm run local:cloud` runs the same handlers against explicitly configured AWS dev/test DynamoDB tables.

Cloud mode requires existing dev/test tables and AWS credentials. The local adapter bypasses API Gateway JWT authentication; cloud-mode POST requests can write to the configured tables. Keep it bound to loopback and use credentials restricted to dev/test data. See [API_GUIDE.md](./API_GUIDE.md) for setup details.

## AWS infrastructure

The AWS CDK app is defined in `lib/stack/`. Deploy with:

```bash
npm run deploy
```

Deployment requires AWS credentials and targets the account and region configured for CDK. Review the synthesized template with `npm run synth` before deploying. DynamoDB tables use a retain removal policy so stack removal does not delete their data.

## Project layout

- `lib/stack/` — CDK app, Lambda functions, API Gateway routes, and DynamoDB tables
- `src/main/lambda/handlers/` — Lambda request handlers and booking/pricing logic
- `src/test/` — unit tests
- `scripts/` — data seeding and local development utilities
