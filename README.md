# Blockbuster Theatre Backend

Backend API and AWS CDK infrastructure for the Blockbuster Theatre website. The API runs on AWS Lambda behind API Gateway and uses DynamoDB for movie catalogue, movie collections, ticket pricing, and booking offer data.

> **Backend refactor in progress:** Do not deploy yet. The stack name is being updated, but resource names, handlers and the deployment workflow have not all been migrated. Existing production resources already use `-PROD` names, so names must be checked for collisions before deployment.

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

- `GET /movies` and `GET /movies/{id}` for the movie catalogue. The list endpoint returns visible movies and provides a continuation token when needed.
- `GET /collections/{id}` for a TMDB list and its movies currently in the catalogue.
- `GET /film-selections` for active movie and offer booking selections.
- `GET /ticket-pricing` for pricing resolved by movie or offer, weekday, and showtime.
- `POST /checkout/validate` to validate booking selections and calculate authoritative totals.
- `GET /bookings` to list booked seats for a showing, and `POST /bookings` to book seats (stored with a user ID, randomly generated until login exists).
- `GET /api/v1/bookings/guest` and `POST /api/v1/bookings/guest` for date-specific, unpaid guest bookings with backend-validated ticket totals, stable `showtimeId` values, and a separate `BBT-######` email/QR reference.
- `GET /api/v1/bookings/account` for Cognito-protected seat availability with the signed-in user's own booked seats, and `POST /api/v1/bookings/account` to create account-linked bookings.
- `POST /api/v1/auth/convert-guest` to convert a guest booking to a Cognito account using its one-time conversion token.
- `POST /booking/confirmation` for the legacy demo confirmation email endpoint; guest reservations send their own booking-reference confirmation email.
- `POST /collections/refresh` to refresh all pages for a batch of TMDB lists. Protected admin routes require the configured API Gateway JWT authorizer.

See [API_GUIDE.md](./API_GUIDE.md) for booking data examples and local API instructions.

## Local API testing

The local API adapter invokes the Lambda handlers without deploying them. It offers two database modes:

- `npm run local` starts DynamoDB Local, initializes local tables and fixtures, and runs the API at `http://127.0.0.1:3000`.
- `npm run local:cloud` runs the same handlers against explicitly configured AWS dev/test DynamoDB tables.

Cloud mode requires existing dev/test tables and AWS credentials. The local adapter bypasses API Gateway JWT authentication; cloud-mode POST requests can write to the configured tables. Keep it bound to loopback and use credentials restricted to dev/test data. See [API_GUIDE.md](./API_GUIDE.md) for setup details.

## AWS infrastructure

The existing CDK app is being refactored in place. It now synthesizes
`BlockbusterTheatreBackendStack-PROD` or `BlockbusterTheatreBackendStack-DEV`.
Both environments reference the existing shared Cognito pool, frontend client,
Postman client, and SES identity. They do not create an API custom-domain mapping.
The shared Cognito pre-token trigger remains owned by the existing stack.

The table, Lambda and API changes and the GitHub Actions workflow are not yet
complete. Do not deploy the synthesized stack until those changes are finished
and physical names have been checked against deployed resources.

## Project layout

- `lib/stack/` — CDK app, Lambda functions, API Gateway routes, and DynamoDB tables
- `src/main/lambda/handlers/` — Lambda request handlers and booking/pricing logic
- `src/test/` — unit tests
- `scripts/` — data seeding and local development utilities
