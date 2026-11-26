# Blockbuster Theatre Backend

Backend API and AWS CDK infrastructure for the Blockbuster Theatre website. The API runs on AWS Lambda behind API Gateway and uses DynamoDB for movie catalogue, movie collections, ticket pricing, and booking offer data.

> **Do not deploy yet:** The new stacks and API require validation and live resource-name collision checks. Existing production resources must remain untouched.

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

Synthesize each CDK stack without deploying it, using a non-secret placeholder
and an output directory outside the checkout:

```powershell
$env:TMDB_API_KEY = 'synth-placeholder'
npx cdk synth BlockbusterTheatreBackendStack-DEV -c env=dev --output "$env:TEMP\blockbuster-synth-dev" --quiet
npx cdk synth BlockbusterTheatreBackendStack-PROD -c env=prod --output "$env:TEMP\blockbuster-synth-prod" --quiet
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

The AWS CDK app is defined in `lib/stack/`. Set `TMDB_API_KEY` to a non-empty TMDB read access token before synthesis. A direct deployment must also provide it as the masked CloudFormation parameter `TmdbApiKey`:

```bash
npm run deploy -- --parameters "TmdbApiKey=$TMDB_API_KEY"
```

Command-line arguments can be visible to local processes. Deployment requires AWS credentials and targets the account and region configured for CDK. Review the synthesized template with `npm run synth` before deploying. The first deployment after this change requires the parameter.

The dev stack has its own API Gateway, application Lambdas and DynamoDB tables, but shares the production Cognito pool and client and the SES email identity. Cognito users and changes to those users are therefore shared; the Cognito pre-token Lambda belongs to the shared pool. Named production resources use `-PROD`; dev resources use `-DEV`. Dev tables are deleted with the dev stack; production tables are retained. The new production tables are empty until data is copied from the retained unsuffixed tables.

GitHub Actions assumes the CDK bootstrap deployment role to read the `UserPoolId` and `UserPoolClientId` outputs from the deployed `BlockbusterTheatreBackendStack`, then passes them as dev CloudFormation parameters. The production stack and outputs must already exist, and the GitHub Actions role must be allowed to assume the bootstrap deployment role. Set the dev GitHub Environment variable `PROD_POSTMAN_CLIENT_ID` to the shared Cognito `postman-test-client-PROD` ID so the dev authorizer accepts Postman tokens. Recreating Cognito requires new frontend and Postman IDs and a dev redeployment. For a local dev deployment, supply `--parameters ProdUserPoolId=<pool-id> --parameters ProdUserPoolClientId=<client-id> --parameters ProdPostmanClientId=<postman-client-id>` to `cdk deploy -c env=dev`, or synthesize with the corresponding `prodUserPoolId`, `prodUserPoolClientId`, and `prodPostmanClientId` CDK context values.

For a manual GitHub Actions deployment, select `target_env` and optionally a build number. The job binds to the matching GitHub Environment and requires its `TMDB_API_KEY` secret. By default prod requires a successful `main` push build; dev can select builds across branches. The `allow_non_main_prod` override deliberately weakens the production restriction. Check the build and its source before deploying, especially to production. The workflow synthesizes the selected source and rejects older builds that do not support the masked TMDB parameter. The deployment assembly supports file assets, not Docker or executable assets. Automatic deployments remain limited to successful push builds on `dev` and `main`. See [API_GUIDE.md](./API_GUIDE.md) for environment and OIDC setup.

## Project layout

- `bin/` — CDK application entry point
- `lib/auth/` — Dedicated `BlockbusterTheatreAuthStack` (Cognito User Pool, Domain, Resource Server, Clients, and SSM exports)
- `lib/backend/` — `BackendStack` (DynamoDB, SES, Lambdas, API Gateway HTTP API, and JWT Authorizer)
- `lib/shared/` — Shared environment utilities, naming helpers, and typed SSM read/write helpers
- `src/handlers/` and `src/services/` — request handlers and domain logic
- `src/test/` — Unit and integration tests
- `scripts/` — Data seeding and local development utilities
