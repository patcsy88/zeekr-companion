# ADR-007: Optional Sentry error reporting

Status: accepted by the owner on 2026-10-28; code written and tested, **not yet deployed and no Sentry project has a DSN configured in the app**.

## Context

The owner wants crash and error reports for the API and the PWA. Sentry is a new external service (approval gate), so the owner approved hosted Sentry on the free tier, under an organisation the owner controls, with two projects: one for the API and one for the web client. The app holds personal records (service history, expenses, warranty claims, a login), so reports must carry as little as possible.

## Decision

- Hosted Sentry, free tier only. No paid plan, no session replay, no performance tracing, no user feedback widget, no profiling.
- **Off by default.** Nothing is initialised unless a DSN is set: `SENTRY_DSN_API` in the host `infra/.env` (passed to the API as `SENTRY_DSN`), and `VITE_SENTRY_DSN` when the web client is built on the owner's Mac. Tests and local runs send nothing.
- **Allow-list scrubbing on both sides.** Each event is rebuilt from a short list of fields before it leaves: event id, time, level, platform, release, environment, the request method and URL path (no query string, headers, cookies or body), and for exceptions only the type and the stack frames (file, function, line). Exception messages are dropped because database and validation errors can echo submitted values. User, tags, extra data, breadcrumbs, local variables and the server name are never sent. Log messages are replaced by a fixed string.
- The SDK options also switch off default personal data, cookies, headers, bodies, query strings and breadcrumbs, so the scrubber is a second layer.
- The web CSP gains `connect-src 'self' https://*.sentry.io`. This is the only outbound allowance. `infra/Caddyfile`, `apps/web/csp.ts` and `infra/smoke.sh` change together, and the CSP drift test guards the first two.
- A DSN is not a password: it only lets a sender submit events. It still stays out of the repo. Because the web DSN is readable in the shipped JavaScript, the owner should set an inbound rate limit on the Sentry project to protect the quota.

## Consequences

- Debugging is harder than with full reports: no request data and no exception messages. That is deliberate.
- Frames show bundled file names and line numbers. Readable web stack traces would need source maps uploaded with an auth token at build time. Not done; revisit only if needed.
- The browser SDK adds about 100 KB to the bundle when built.
- The free-tier quota can run out; Sentry then drops events and the app is unaffected.
- Reports go to Sentry's servers. The owner chooses the data region when creating the organisation.
- A `before_send` bug could leak data, so both scrubbers have tests with fake secrets.

## Owner steps (not done by an agent)

1. Create projects `zeekr-companion-api` (FastAPI) and `zeekr-companion-web` (React) in the owner's organisation. Skip the SDK wizard.
2. Set an inbound rate limit on both projects.
3. Put the API DSN in the host `infra/.env` as `SENTRY_DSN_API`, recreate the API container.
4. Build the web client on the Mac with `VITE_SENTRY_DSN` set, copy `dist` to the host as usual.
5. Trigger a test error and confirm it arrives with no request data or message.
