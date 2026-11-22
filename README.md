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

## AWS infrastructure

The AWS CDK infrastructure is organized into a domain-driven multi-stack architecture:
- `bin/app.ts` — CDK entry point instantiating `BlockbusterTheatreBlockbusterTheatreAuthStack` and environment-specific `CoreStack` instances (`prod` and `dev`).
- `lib/auth/` — Dedicated `BlockbusterTheatreAuthStack` with `terminationProtection: true` owning the shared Cognito User Pool (`BlockbusterTheatreCognitoUsers`), Cognito Domain, PreTokenGeneration trigger, Resource Server (`bookings.read`), and App Clients (`BackendClient`, `PostmanAppClient`, `AlexaAppClient`).
- `lib/backend/` — `CoreStack` (and constructs like API Gateway, DynamoDB, SES, Lambdas) consuming Cognito identifiers from SSM Parameter Store instead of CloudFormation parameters or cross-stack exports.
- `lib/shared/` — Shared environment helpers, resource naming utilities, and typed SSM Parameter Store read/write helpers.

### Cognito Authentication & SSM Parameter Store Wiring

Cognito identifiers are exported by `BlockbusterTheatreAuthStack` to AWS Systems Manager (SSM) Parameter Store under a consistent namespace:
- `/blockbuster-theatre/auth/user-pool-id` — User Pool ID
- `/blockbuster-theatre/auth/user-pool-arn` — User Pool ARN
- `/blockbuster-theatre/auth/clients/backend-id` — Backend SRP App Client ID
- `/blockbuster-theatre/auth/clients/postman-id` — Postman OAuth App Client ID
- `/blockbuster-theatre/auth/clients/alexa-id` — Alexa Skill OAuth App Client ID

Both `BlockbusterTheatreCoreStack` (prod) and `BlockbusterTheatreCoreStack-dev` resolve these values from SSM Parameter Store at deploy time. `HttpJwtAuthorizer` accepts tokens from all valid clients (`jwtAudience: [backendClientId, postmanClientId, alexaClientId]`). API Gateway routes omit `authorizationScopes` so routes accept both direct-SRP tokens and OAuth tokens. Because cross-stack CloudFormation export locks (`Fn::ImportValue`) are avoided, `CoreStack` instances (`prod` and `dev`) can be deployed, destroyed, and recreated completely independently.

The shared pool has separate `bookings.read` resource servers for `https://api.blockbuster-theatre.nml-applications.com` and `https://api-dev.blockbuster-theatre.nml-applications.com`. Alexa account linking should request the corresponding full scope (`<identifier>/bookings.read`) for its target environment. These scopes are not enforced by API Gateway routes; the JWT authorizer validates the token issuer, audience and validity, not the environment-specific scope. The backend client has OAuth disabled and uses direct SRP or admin password authentication.

Before deploying the auth stack, inspect the shared pool for a manually created resource server with the DEV identifier. If present and not already managed by this stack, coordinate with its consumers and remove it in the Cognito console before deployment to avoid an `AlreadyExists` conflict. Removing it can interrupt existing DEV account linking until deployment completes. Preserve the existing PROD resource server, and review `cdk diff BlockbusterTheatreBlockbusterTheatreAuthStack` before deployment.

### Deployment & CI/CD

Set `TMDB_API_KEY` to a non-empty TMDB read access token before backend synthesis:

```bash
# Synthesize all stacks
npm run synth

# Synthesize a specific stack
npx cdk synth BlockbusterTheatreBlockbusterTheatreAuthStack
npx cdk synth -c env=prod -c stack=backend BlockbusterTheatreCoreStack
npx cdk synth -c env=dev -c stack=backend BlockbusterTheatreCoreStack-dev

# Deploy BlockbusterTheatreAuthStack independently
npx cdk deploy BlockbusterTheatreBlockbusterTheatreAuthStack

# Deploy CoreStack
npx cdk deploy BlockbusterTheatreCoreStack --parameters "TmdbApiKey=$TMDB_API_KEY"
```

In GitHub Actions, the deployment workflow (`deploy.yml`) supports deploying `BlockbusterTheatreAuthStack` and `CoreStack` independently via `workflow_dispatch` by specifying `target_stack: auth` or `target_stack: backend`.

## Project layout

- `bin/` — CDK application entry point
- `lib/auth/` — Dedicated `BlockbusterTheatreAuthStack` (Cognito User Pool, Domain, Resource Server, Clients, and SSM exports)
- `lib/backend/` — `CoreStack` (DynamoDB, SES, Lambdas, API Gateway HTTP API, and JWT Authorizer)
- `lib/shared/` — Shared environment utilities, naming helpers, and typed SSM read/write helpers
- `src/main/lambda/handlers/` — Lambda request handlers and booking/pricing logic
- `src/test/` — Unit and integration tests
- `scripts/` — Data seeding and local development utilities
