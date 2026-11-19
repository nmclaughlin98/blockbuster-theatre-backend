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

The AWS CDK app is defined in `lib/stack/`. Set `TMDB_API_KEY` to a non-empty TMDB read access token before synthesis. A direct deployment must also provide it as the masked CloudFormation parameter `TmdbApiKey`:

```bash
npm run deploy -- --parameters "TmdbApiKey=$TMDB_API_KEY"
```

Command-line arguments can be visible to local processes. Deployment requires AWS credentials and targets the account and region configured for CDK. Review the synthesized template with `npm run synth` before deploying. The first deployment after this change requires the parameter.

The dev stack has its own API Gateway, application Lambdas and DynamoDB tables, but shares the production Cognito pool and client and the SES email identity. Cognito users and changes to those users are therefore shared; the Cognito pre-token Lambda belongs to the shared pool. Named production resources use `-PROD`; dev resources use `-DEV`. Dev tables are deleted with the dev stack; production tables are retained. The new production tables are empty until data is copied from the retained unsuffixed tables.

GitHub Actions assumes the CDK bootstrap deployment role to read the `UserPoolId` and `UserPoolClientId` outputs from the deployed `BlockbusterTheatreBackendStack`, then passes them as dev CloudFormation parameters. The production stack and outputs must already exist, and the GitHub Actions role must be allowed to assume the bootstrap deployment role. Set the dev GitHub Environment variable `PROD_POSTMAN_CLIENT_ID` to the shared Cognito `postman-test-client-PROD` ID so the dev authorizer accepts Postman tokens. Recreating Cognito requires new frontend and Postman IDs and a dev redeployment. For a local dev deployment, supply `--parameters ProdUserPoolId=<pool-id> --parameters ProdUserPoolClientId=<client-id> --parameters ProdPostmanClientId=<postman-client-id>` to `cdk deploy -c env=dev`, or synthesize with the corresponding `prodUserPoolId`, `prodUserPoolClientId`, and `prodPostmanClientId` CDK context values.

For a manual GitHub Actions deployment, select `target_env` and optionally a build number. The job binds to the matching GitHub Environment and requires its `TMDB_API_KEY` secret. By default prod requires a successful `main` push build; dev can select builds across branches. The `allow_non_main_prod` override deliberately weakens the production restriction. Check the build and its source before deploying, especially to production. The workflow synthesizes the selected source and rejects older builds that do not support the masked TMDB parameter. The deployment assembly supports file assets, not Docker or executable assets. Automatic deployments remain limited to successful push builds on `dev` and `main`. See [API_GUIDE.md](./API_GUIDE.md) for environment and OIDC setup.

## Project layout

- `lib/stack/` — CDK app, Lambda functions, API Gateway routes, and DynamoDB tables
- `src/main/lambda/handlers/` — Lambda request handlers and booking/pricing logic
- `src/test/` — unit tests
- `scripts/` — data seeding and local development utilities
