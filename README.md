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

- `GET /api/v1/movies` and `GET /api/v1/movies/{movieId}` for the catalogue.
- `GET /api/v1/collections/{collectionId}`, `GET /api/v1/checkout/current-selections`, and `GET /api/v1/pricing` for booking selections.
- `POST /api/v1/checkout/validate` validates selections and calculates totals.
- `GET /api/v1/bookings` and `POST /api/v1/bookings` support guests and signed-in users; supplied tokens are verified.
- `GET /api/v1/bookings/{bookingId}` and its `/ticket` and `/confirmation` routes require the owner or guest reference and email.
- `PATCH /api/v1/bookings/{bookingId}/reschedule` permits any signed-in operator for now.
- `POST /api/v1/auth/convert-guest-bookings` converts a guest booking using its one-time token.
- Movie, collection, pricing, offer and showtime management routes require a Cognito JWT.

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

The table, Lambda and API changes are not yet complete. The GitHub Actions
deployment job is disabled during the refactor. Do not deploy the synthesized
stack until the changes are finished and physical names have been checked against
deployed resources. Once the guard is removed, each GitHub Environment must
provide `PROD_USER_POOL_ID`, `PROD_USER_POOL_CLIENT_ID`, and
`PROD_POSTMAN_CLIENT_ID` as variables and `TMDB_API_KEY` as a secret.

## Project layout

- `lib/stack/` — CDK app, Lambda functions, API Gateway routes, and DynamoDB tables
- `src/handlers/` and `src/services/` — request handlers and domain logic
- `src/test/` — unit tests
- `scripts/` — data seeding and local development utilities
