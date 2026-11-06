# Zeekr Companion

A personal vehicle-management app for one owner's Zeekr 7X AWD Performance (RHD, Malaysia). It is a mobile-first web app (PWA) that you install to the iPhone home screen from Safari, backed by a self-hosted API. Amounts are in MYR (stored as integer sen) and distances in km.

Status: in daily use by one owner on a self-hosted Ubuntu host. It is a personal project, not a product. There is no multi-user support and no native app.

## What it does

The app works fully from manual records. Live car data is optional and off by default.

- **Service:** service records with date, odometer, provider, description and cost.
- **Reminders:** service reminders by date and odometer, a completion flow that records the service, and a template for the maintenance schedule.
- **Expenses:** costs by category, with monthly totals and an optional energy (kWh) figure for charging.
- **Warranty:** coverages and claims, with a template of the standard coverage items.
- **Vehicle:** the vehicle's details, plus a live card (battery, range, tyre pressures, odometer and other indicators) and a history page when live readings are on.
- **Sentry:** shows the car's Sentry state, and has a switch that asks before it sends Sentry on or off. An optional "Automatic Sentry on" sends Sentry on once when the car is parked asleep outside your home area. It has a second lock on the host.
- **Geofence:** an in-app notice when the car is parked outside your home area with Sentry off. The home point is set on the host and never stored in the repo.
- **Advisory:** rule-based suggestions, such as a service pace check, that you can accept or decline. They are proposals only and never act on their own. A hosted model can explain them, but it is off by default and has never been called.
- **Offline use:** records are cached on the device and changes made offline are queued, then sent when you are back online.
- **Sign in:** one owner account with a username and password. There is a single "Sign out and clear local data" button.
- **Backups:** scheduled database dumps and an encrypted off-site export, with a restore check (`infra/backup/RESTORE.md`).

The only command the app can send to the car is Sentry on or off (ADR-010). Everything else it reads from the car is read-only.

## How it is built

- **Client:** React, Vite and TypeScript PWA (`apps/web`), served same-origin through a Caddy container.
- **API:** Python, FastAPI and PostgreSQL (`services/api`), with database migrations.
- **Run:** Docker Compose on one Ubuntu host (`infra/`).
- **Live data:** an unofficial client for the Zeekr app's interface. It is optional, read-only apart from Sentry, and uses a second Zeekr account.

## Installation

You need a Linux host with Docker Engine and the Compose plugin. The app has no firewall of its own, and the web port speaks plain HTTP. Keep it on a private network and never expose it to the internet.

### Option A: published images (one compose file, no build)

The images are `linux/amd64` only. Check with `uname -m`.

1. Make a folder and download three files from `infra/` into it: `docker-compose.release.yml` (save it as `docker-compose.yml`), `.env.example` and `install.sh`. Then run `chmod +x install.sh`.
2. Run `./install.sh --version v0.1.0`. It writes `.env` with random `POSTGRES_PASSWORD` and `TOKEN_SECRET` values, never prints them, and sets the file to mode 600. It refuses to run if `.env` already exists, because a new database password would lock the app out of an existing database.
3. Run `docker compose up -d --wait`.
4. Create the app login. It asks for a username and a password of at least 12 characters:
   `docker compose exec api python -m app.cli.set_owner`
5. Open the app on port 8080. By default it listens on `127.0.0.1` only. To reach it from your phone, read `WEB_BIND_ADDRESS` in `docs/operations/deploy-guide.md` first.

There is no `latest` tag. To update, set `ZEEKR_VERSION` in `.env` to the new tag, then run `docker compose pull` and `docker compose up -d --wait`.

### Option B: from a clone (builds on the host)

1. Clone the repository and go into `infra/`.
2. Run `./install.sh`.
3. Run `docker compose up -d --build --wait`.
4. Create the app login as in Option A, step 4.

To update, run `git pull`, then `docker compose up -d --build --wait` again. A release that adds a database migration needs a fresh encrypted export first.

Back up `.env` somewhere private. It cannot be recovered, and it must never be committed or pasted anywhere. Two installs on one machine share the same compose project name, so give the second one a different project name, port and subnet. Details, backups and rollback are in `docs/operations/deploy-guide.md`.

## Live car data from a second Zeekr account (optional)

Live readings, the geofence notice and the Sentry switch stay off until you set this up. They use an **unofficial** client, not a supported Zeekr interface. Zeekr's terms on this are not confirmed, and the account can be restricted. Read `docs/architecture/decisions/ADR-009-live-zeekr-provider.md` first.

**Use a second Zeekr account, never your main one.** Each call by the client logs the phone app out unless the car is shared to another account.

1. Create a second Zeekr account and share the car to it. The account name is sent as an email, so use an email-based account.
2. Get six values from the Zeekr phone app: an HMAC access key, an HMAC secret key, a password public key, a production signing secret, a VIN key and an IV. Extracting them is left to you. ADR-009 describes the extractor that was used. It can print several candidates for the signing secret, and a wrong one fails the login. Each try is a full login on the second account.
3. In the host `.env` only, set `ZEEKR_USERNAME`, `ZEEKR_PASSWORD`, `ZEEKR_COUNTRY_CODE` (`MY` for a Malaysian account) and the six values `ZEEKR_HMAC_ACCESS_KEY`, `ZEEKR_HMAC_SECRET_KEY`, `ZEEKR_PASSWORD_PUBLIC_KEY`, `ZEEKR_PROD_SECRET`, `ZEEKR_VIN_KEY` and `ZEEKR_VIN_IV`. Then set `ZEEKR_LIVE_ENABLED=true` and run `docker compose up -d`. If any value is missing, the API refuses to start and names the setting, never a value.
4. Never put these values in the repository, in chat, in logs or in an issue.

Risks: a wrong password can cause up to five login attempts on the second account before the app stops trying, which could lock it. The client can break without notice.

## Start here

- `AGENTS.md`: operating principles and approval gates
- `docs/product/`: brief and requirements
- `docs/architecture/`: architecture, API contracts, ADRs
- `docs/operations/deploy-guide.md`: install, update, back up and roll back
- `docs/testing/test-strategy.md`: quality gates
- `docs/research/vehicle-integrations.md`: integration research

## Working with the agent team

Run `opencode` in this directory. The default agent is `engineering-lead`, which delegates to the subagents in `.opencode/agents/`.

## Public repository rules

This repository is public. It holds no secrets, VIN, plate, home address, host or network names, or readings from the car. Real values live only in the host `.env`.
