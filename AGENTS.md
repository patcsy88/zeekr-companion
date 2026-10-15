# Zeekr Companion: Engineering Operating Principles

## Mission

Build a reliable, secure and maintainable mobile-friendly web application for managing a Zeekr 7X AWD (RHD), initially for personal use by one owner.

## Confirmed decisions

- Client: mobile-responsive React + Vite + TypeScript PWA (ADR-002), installable from iOS Safari, served same-origin through a reverse proxy container. No native app, so no Apple Developer enrolment.
- Backend: Python + FastAPI + PostgreSQL, self-hosted on a standalone Ubuntu Server (homelab hardware, ADR-004) with Docker Compose.
- Vehicle data: manual records first. Official Zeekr integrations are researched in parallel and never block the MVP.
- First release: maintenance, expenses and ownership records.

See `docs/architecture/decisions/` for the rationale.

## Engineering principles

1. Requirements and acceptance criteria precede implementation.
2. Architecture decisions and API contracts are documented before dependent code is written.
3. Keep mobile presentation, application services, persistence and external integrations separate.
4. Use typed interfaces, database migrations and automated tests.
5. Do not invent vehicle capabilities, API endpoints, telemetry or specifications.
6. Record the source, confidence and verification status of every vehicle integration assumption.
7. Prefer supported, documented interfaces over reverse-engineered or unofficial control mechanisms.
8. Never commit credentials, tokens, private vehicle identifiers or personal data.
9. Do not run destructive commands or modify production data without explicit approval.
10. Do not mark work complete merely because code was written.

## Definition of done

- Acceptance criteria are satisfied.
- Relevant automated tests pass.
- Formatting, linting and type checks pass.
- Security and regression implications have been assessed.
- Documentation and migrations are updated where applicable.
- Limitations and outstanding risks are disclosed.
- The final report lists the changes made and the verification evidence (commands run and their results).

## Human approval gates

Stop and ask the product owner before:

- Adding a new external service or paid dependency (including remote-access tooling and any HTTPS certificate or domain purchase).
- Enabling any vehicle-control capability.
- Accessing sensitive vehicle or account data.
- Running destructive operations.
- Releasing or deploying to any environment.
- Expanding scope beyond the current milestone.

## Conventions

- Market: Malaysia (confirmed by the owner on 2026-10-11). Earlier UK assumptions are void.
- Units: kilometres and MYR (both confirmed by the owner on 2026-10-11). Store money as integer minor units (sen) with a `currency` field that defaults to MYR, and distances as integers in kilometres.
- Timestamps: UTC in storage, local time in the UI.
- Documents under `docs/` are the shared source of truth. Update them in the same change as the code.
- Label vehicle claims as `confirmed`, `proposed` or `unverified`.

## Repository layout

- `apps/web`: React + Vite PWA client
- `services/api`: FastAPI service
- `packages/shared-types`: shared contracts
- `infra`: Docker Compose and deployment files
- `docs`: product, architecture, research, testing and operations documents
- `.opencode`: project agents and skills

## Quality gates

Defined in `docs/testing/test-strategy.md`. All must pass before work is reported complete.
