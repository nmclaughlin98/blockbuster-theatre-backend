# Phase 1 backend refactor handoff

## Continuation update

The current branch remains `complete-rework-of-api`. The deployment guard
remains disabled and this refactor is still **not ready to deploy**.

- Updated movie, collection, pricing, showtime, migration-script and API
  Gateway tests to exercise the new keys, routes and indexes.
- Added locally signed JWT tests using the real Cognito verifier and an
  in-memory JWKS. Invalid and missing issuers now produce an invalid-token
  error rather than an internal error; verification infrastructure failures
  still propagate. These tests do not verify live Cognito or API Gateway.
- The latest `npm test -- --silent` run had 5 failing suites, 31 passing
  suites, 62 failing tests and 386 passing tests. The failing suites were
  `src/test/lib/{stack,lambda,dynamo-db}.test.ts`,
  `src/test/workflows/deploy.test.ts`, and
  `src/test/handlers/Shared/bookings.test.ts`. Workflow tests that spawn
  `bash` cannot run in this Windows environment (`spawnSync bash ENOENT`);
  run them in an environment with Bash before drawing conclusions.
- `npm run build` passed after the authentication change. The focused JWT and
  booking security run passed 87 tests; the updated schema and gateway
  suites passed 160 tests. DEV and PROD syntheses passed serially with a
  placeholder TMDB key; neither is evidence of deployment safety.
- Remaining work includes the other failing suites, real integration and
  authorization verification, remaining documentation and naming alignment,
  and deployment-safety review. Do not remove the legacy bookings tests
  without replacing their meaningful coverage for the new contract.

The status and validation details below describe the **previous** handoff,
not the latest continuation.

## Objective and current status

Continue the Phase 1 backend refactor on the currently checked-out
`complete-rework-of-api` branch. The outstanding request is to:

1. Update and run tests against the new schemas and routes.
2. Verify booking creation, guest conversion and linking, authorization,
   tickets, confirmations, and movie/showtime flows.
3. Finish CDK naming and documentation alignment.

**The refactor is not complete and must not be deployed.** The most recent
full test run failed. A successful build or synthesis does not establish
deployment safety or prove that the endpoints work end to end.

At handoff, the worktree was clean. Check `git status --short` and
`git branch --show-current` again before making changes; the environment may
be shared. Preserve any subsequent work.

## Boundaries and decisions

- Work only in this backend repository and the current branch. Do not modify
  the frontend.
- Do not deploy, destroy, perform AWS write operations, commit, push, switch
  branches, or enable the deployment job without explicit approval.
- Do not touch the existing `BlockbusterTheatreBackendStack` or its deployed
  production tables and shared resources. The intended new application stacks
  are `BlockbusterTheatreBackendStack-PROD` and
  `BlockbusterTheatreBackendStack-DEV`, with environment-suffixed resources.
- No migration or production data copy is authorized at this stage. New tables
  start empty. Existing shared Cognito, SES and DNS resources remain owned by
  the existing stack; importing them does not make that stack safe to destroy.
- Rename and modify existing files where practical; create new files only for
  genuinely new resources or where explicitly requested.
- For now, operator endpoints allow any signed-in user. Guests cannot
  reschedule; customers do not reschedule themselves.
- Continue automatic guest linking only for a verified email from an ID token,
  controlled by the environment-specific `ALLOW_LINK_BOOKINGS` Parameter Store
  flag. Guest conversion tokens must remain supported.
- Preserve the shared pre-token trigger's `member_since` source: Cognito
  `UserCreateDate`, not token issue time or the current time.
- Keep the deployment guard in [deploy.yml](.github/workflows/deploy.yml)
  disabled. Do not assume physical resource names are available merely because
  synthesis succeeds.

## Implemented contract to verify

- Routes are under `/api/v1`; the descriptive checkout route is
  `/api/v1/checkout/current-selections`.
- Movies use `movieId` as their DynamoDB key; `tmdbId` remains an attribute
  and API field. The movie indexes are `MoviesByReleaseDate` and
  `MoviesByScore`.
- Bookings share one table with `PK` and `SK`:
  - Booking metadata: `BOOKING#{bookingId}` / `METADATA`.
  - Seat lock: `SHOWTIME#{showtimeId}` / `SEAT#{seat}`.
  - Reference lock: `REFERENCE#{bookingRef}` / `METADATA`.
  - Indexes: `UserBookings`, `CustomerEmailBookings`, and `ShowtimeBookings`,
    using `screeningKey` for the relevant ordering.
- Optional-auth endpoints must verify any supplied token. Authenticated
  identity comes from a verified Cognito `sub`, never a request body or
  unverified authorizer-shaped input.
- An owner can access their booking; an unlinked guest can access it with
  both booking reference and email. Confirmation must use stored booking data.
- Rescheduling must atomically update metadata and move all seat locks,
  preserving booking ID, reference, seats, and price; conflicts must not
  partially change the booking.

These are intended contracts, not a claim that every integration is verified.
Inspect the implementation and test real behavior rather than merely changing
expectations to make tests pass.

## Progress made

- Updated focused tests for movie imports, booking creation and guest
  conversion, guest linking, ticket download, and stored-data confirmation.
- Updated CDK database construct IDs and stack parent construct IDs; explicit
  table logical-ID overrides were retained. Renaming parent constructs can
  change generated logical IDs for other resources, so inspect the templates
  and replacement implications before any future deployment.
- Updated parts of [README.md](README.md) and [API_GUIDE.md](API_GUIDE.md);
  further alignment remains.
- Corrected the HTML confirmation message in
  [booking-confirmation-email.ts](src/services/bookings/booking-confirmation-email.ts):
  it no longer claims no reservation was created when the text says one was
  recorded.
- Focused booking tests mock optional authentication. Their passing results
  do **not** verify real JWT signatures, Cognito token claims, or API Gateway
  integration. The local API adapter also does not replace that verification.

## Most recent validation

- `npm run build`: passed.
- Seven focused booking/movie suites: **98 tests passed**.
- `npm test -- --silent`: **15 suites failed, 21 passed; 127 tests failed,
  311 passed**. This is the latest full-suite result, not a current guarantee
  if files subsequently change.
- Both DEV and PROD CDK syntheses passed serially with a non-secret placeholder
  `TMDB_API_KEY`. An initial attempt without that variable failed.
- No deployment or live AWS mutation was performed.

The latest full output, if the original session still exists, is at
`C:\Users\ndude\.copilot\session-state\8d5bdec3-04bc-4b66-8161-e486e17ba0f2\files\phase1-test-latest.log`.
The original blueprint was stored outside the repository at
`C:\Users\ndude\.copilot\session-state\8d5bdec3-04bc-4b66-8161-e486e17ba0f2\files\RefactorApproach.md`;
it may not be available in another session or checkout.

### Failing suites from the last full run

- `src/test/lib/lambda.test.ts`
- `src/test/lib/stack.test.ts`
- `src/test/lib/dynamo-db.test.ts`
- `src/test/lib/gateway.test.ts`
- `src/test/workflows/deploy.test.ts`
- `src/test/handlers/Shared/movie-collections.test.ts`
- `src/test/handlers/Shared/special-offers.test.ts`
- `src/test/handlers/Shared/movie-schedule-service.test.ts`
- `src/test/handlers/Shared/bookings.test.ts`
- `src/test/handlers/ListMovies/list-movies.test.ts`
- `src/test/handlers/UpdateMovies/update-movies.test.ts`
- `src/test/handlers/GetMovie/get-movie.test.ts`
- `src/test/handlers/ListFeaturedMovies/list-featured-movies.test.ts`
- `src/test/scripts/migrate-movie-image-urls.test.ts`
- `src/test/scripts/migrate-movie-showtimes.test.ts`

Some failures are stale route, schema, naming or import expectations; others
may reveal implementation defects. In particular, the shared bookings suite
still imports a removed legacy handler and cannot run. Inspect each failure and
retain meaningful coverage; do not delete tests merely to reduce the count.

## Recommended continuation

1. Inspect the current worktree, the listed failing tests, and their current
   handler/service implementations. Update tests in coherent groups, starting
   with movie retrieval/listing/update, collections and showtimes, then
   booking-related legacy imports and scripts.
2. Update CDK, gateway and workflow tests for actual resource names, routes,
   permissions, schemas and the disabled deployment guard. Verify generated
   logical IDs and both environment templates; do not change the old stack.
3. Complete integration/security coverage, including:
   - Actual JWT verification with valid and invalid tokens, access versus ID
     tokens, verified versus unverified emails, and failed verification.
   - Owner, unrelated user and unlinked guest access for booking, ticket and
     confirmation; confirmation must ignore attacker-supplied booking data.
   - Guest conversion, linking and SSM flag states, including conditional
     claim races and notification failures.
   - Atomic booking conflicts, reference retry, reschedule conflicts and
     lock ownership; movie and showtime creation/lookup flows.
4. Review remaining construct IDs, routes and documentation for stale
   guidance. Keep the existing deployment prohibition prominent.
5. Run targeted tests, the build, the full suite, then DEV and PROD synthesis
   serially. Report exact commands and failures. CDK bundling is slow; do not
   run CDK infrastructure tests and syntheses concurrently because previous
   concurrent bundling damaged local dependencies.

Useful entry points: [gateway.ts](lib/stack/gateway.ts),
[dynamo-db.ts](lib/stack/dynamo-db.ts),
[stack-configuration.ts](lib/stack-configuration.ts),
[lambda.ts](src/main/lambda/lambda.ts),
[common.ts](src/main/lambda/handlers/utils/common.ts),
[guest-booking-service.ts](src/services/bookings/guest-booking-service.ts),
[link-guest-bookings.ts](src/services/bookings/link-guest-bookings.ts),
[get-booking-record.ts](src/handlers/bookings/get-booking-record.ts), and
[reschedule-booking-record.ts](src/handlers/bookings/reschedule-booking-record.ts).

## Validation commands

Run from the repository root in PowerShell:

```powershell
git status --short
git branch --show-current
npm run build
npm test -- --silent
```

For focused tests, substitute the desired existing test paths:

```powershell
npm test -- --silent --runTestsByPath src\test\handlers\GuestBooking\guest-booking.test.ts src\test\handlers\GuestBookedSeats\link-guest-bookings.test.ts
```

For local synthesis only, use a placeholder, write output outside the checkout,
and run sequentially. The placeholder is not suitable for deployment:

```powershell
$env:TMDB_API_KEY = 'synth-placeholder'
npx cdk synth BlockbusterTheatreBackendStack-DEV -c env=dev --output "$env:TEMP\blockbuster-phase1-dev" --quiet
npx cdk synth BlockbusterTheatreBackendStack-PROD -c env=prod --output "$env:TEMP\blockbuster-phase1-prod" --quiet
```

Before any later, separately approved deployment, verify live resource-name
availability, shared-resource and pre-token-trigger wiring, and a
CloudFormation change set. Do not treat this handoff as deployment approval.
