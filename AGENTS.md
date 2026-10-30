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

## Names, paths and commands (owner rule, 2026-10-30)

Never guess a name, path, unit, flag or command that the owner will run.

- Before giving the owner any systemd unit name, file path, script argument, container or service name, or command, look it up in the repo (`infra/`, `docs/`, scripts, unit files, `--help` text) and read the file it comes from.
- Quote the source (file and line) when it is not obvious.
- If the repo does not contain the answer, say so plainly. Then either give the read-only command that lets the owner find it (for example `systemctl list-units --all | grep -i zeekr`), or propose a candidate clearly labelled "proposed, not found in the repo" for the owner to decide, and ask the owner to provide the real value.
- Do not present a proposed value as a fact, and do not put it inside a ready-to-run command as if it were confirmed.
- Host facts the agent cannot see (host address, unit names installed on the host, paths on the host) come from the owner, not from assumption.

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
- Timestamps: UTC in storage, local time in the UI. Calendar dates ("today", "not in the future") are judged in Asia/Kuala_Lumpur, UTC+8 (owner decision 2026-10-22).
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
