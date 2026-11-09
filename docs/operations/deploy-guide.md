# Deploy and configure Zeekr Companion

How to run the whole app from three Docker containers on one Ubuntu host. Placeholders only: the real host name, addresses, tailnet name, keys and passwords never go in this repo.

Related: `infra/README.md` (stack details and the Tailscale runbook), `infra/backup/RESTORE.md` (backup and restore), `docs/operations/deploy-plan.md` (the deploy record).

## What runs

| Container | Image                                | What it does                                                                                               | Published port                                         |
| --------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `db`      | `postgres:17-alpine`                 | PostgreSQL. Data lives in the `pgdata` volume.                                                             | none                                                   |
| `api`     | built from `services/api/Dockerfile` | FastAPI. Runs the database migrations each time it starts.                                                 | none                                                   |
| `web`     | built from `infra/web.Dockerfile`    | Caddy. The web client is built inside the image and baked in. It forwards `/api/*` and `/health` to `api`. | `WEB_BIND_ADDRESS:WEB_PORT` (default `127.0.0.1:8080`) |

Everything is in `infra/docker-compose.yml`. Nothing is mounted from the host except the named volumes. There is nothing to build or copy by hand any more: `docker compose up --build` builds the client too.

## Two ways to install

- **From a clone (what the owner's host runs today):** sections 2 to 10 below. It builds the images on the host.
- **From published images, one file (ADR-012):** the section "Install from published images" at the end. It needs no clone and no build.

## 1. Prerequisites

- Ubuntu Server 24.04 LTS with Docker Engine and the Compose plugin (ADR-004). Check with `docker compose version`.
- Internet access from the host while building. The build pulls base images (`node`, `python`, `caddy`, `postgres`) and runs `npm ci` and `pip install`, so it reaches the npm and PyPI registries. Running the stack afterwards needs no internet, except for the optional features below.
- Disk and memory for a Node build. How much the host needs has **not been measured**; if the build is killed, check `dmesg` for an out-of-memory kill.
- The port in `WEB_PORT` (default 8080) free on the host.

## 2. Get the code

```
git clone <repository-url> zeekr-companion
cd zeekr-companion/infra
```

## 3. Configure

```
cp .env.example .env
python3 -c "import secrets; print(secrets.token_urlsafe(24))"   # POSTGRES_PASSWORD
python3 -c "import secrets; print(secrets.token_urlsafe(48))"   # TOKEN_SECRET
```

**Shortcut:** from `infra/`, run `./install.sh`. It creates `.env` from `.env.example` with fresh random values for `POSTGRES_PASSWORD` and `TOKEN_SECRET`, never prints them, sets the file to mode 600, and refuses to run if `.env` already exists (a new database password would lock the API out of an existing database). Add `--start` to run `docker compose up -d --wait` straight after. The two commands above do the same by hand.

Paste the two values into `infra/.env`. `.env` is gitignored. Never paste it, or any value from it, into chat, a ticket or the repo. Compose refuses to start while either is empty.

### Settings

Required:

| Setting             | Meaning                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD` | Database password. Avoid `@`, `/`, `:` and `%`, because it goes into a URL.                             |
| `TOKEN_SECRET`      | Signs access tokens. At least 32 characters, not a placeholder. Changing it signs everyone out at once. |

Access:

| Setting                      | Default                          | Meaning                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `WEB_BIND_ADDRESS`           | `127.0.0.1`                      | The address the web port is published on. Keep loopback unless you deliberately want other devices on your private network to reach the app over plain HTTP. There is no firewall in this stack and the password and token cross the network unencrypted, so never use `0.0.0.0` on a network you do not control, and never expose the port to the internet. |
| `WEB_PORT`                   | `8080`                           | The published port.                                                                                                                                                                                                                                                                                                                                          |
| `WEB_HSTS`                   | `off`                            | `on` adds `Strict-Transport-Security`. Turn it on only once the site is served over HTTPS.                                                                                                                                                                                                                                                                   |
| `CORS_ALLOWED_ORIGINS`       | empty                            | Not needed: the client is served from the same origin.                                                                                                                                                                                                                                                                                                       |
| `WEB_SUBNET`, `WEB_PROXY_IP` | `172.28.77.0/24`, `172.28.77.10` | A fixed network the API trusts for the client address. Change both together only if the subnet clashes with another Docker network.                                                                                                                                                                                                                          |

Optional, all off by default:

| Setting                                                                                                                      | Meaning                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SENTRY_DSN_API`                                                                                                             | API error reporting (ADR-007). Empty sends nothing.                                                                                                                                                                                                        |
| `VITE_SENTRY_DSN`                                                                                                            | Browser error reporting. Read **when the web image is built**, so changing it needs `docker compose build web` and then `docker compose up -d`.                                                                                                            |
| `ADVISORY_MODEL_ENABLED`, `ADVISORY_MODEL_ID`, `ADVISORY_MONTHLY_CALL_LIMIT`, `ANTHROPIC_API_KEY`, `ADVISORY_MODEL_BASE_URL` | Advisory explanations from a hosted model (ADR-008). Set the monthly spend cap in the provider console first. Only derived numbers and dates are sent.                                                                                                     |
| `ADVISORY_TRACING_ENABLED`, `ADVISORY_TRACING_API_KEY`, `ADVISORY_TRACING_API_URL`                                           | Optional tracing. Only timing and status leave the host.                                                                                                                                                                                                   |
| `ZEEKR_LIVE_ENABLED` and the nine `ZEEKR_*` values                                                                           | Live, read-only readings from a **second** Zeekr account the car is shared to (ADR-009). When enabled, every value must be set or the API refuses to start. `ZEEKR_LIVE_INTERVAL_MINUTES` (minimum 5) and `SENTRY_CONFIRM_WAIT_SECONDS` (5 to 30) tune it. |
| `GEOFENCE_ENABLED` and the `GEOFENCE_*` values                                                                               | The away-from-home alert. Needs the live readings. Set `GEOFENCE_HOME_QUERY` or both `GEOFENCE_HOME_LAT` and `GEOFENCE_HOME_LON`. Radius, interval and stale limit can also be changed on the Geofence tab, and a saved value there wins over `.env`.      |
| `GEOFENCE_AUTO_SENTRY_ALLOWED`                                                                                               | Second lock for automatic Sentry on (ADR-011). Keep `false` until the geofence alert has been proven on a real stay.                                                                                                                                       |

Leave the optional features off for a first start. Turn each on later, one at a time, and restart the API (`docker compose up -d`).

## 4. First start

```
cd infra
docker compose up -d --build --wait
```

The first build takes several minutes. `--wait` returns when all three containers are healthy. If your user is not in the `docker` group, put `sudo` in front of each `docker` command.

Create the owner login (it prompts for a username and a password of at least 12 characters, typed twice):

```
docker compose exec api python -m app.cli.set_owner
```

The same command resets a forgotten password. It takes effect at the next sign-in. Until it has run, every sign-in returns 401.

### Optional: a code from an authenticator app at sign-in (ADR-013)

Needs the owner login from above. Run it in a private terminal on the host, not in a shared session:

```
docker compose exec api python -m app.cli.set_mfa
```

It draws a QR code in the terminal, prints the same key as text, and asks for the 6-digit code now shown in the app (Google Authenticator or any app that reads time-based codes). It saves nothing until that code is right. It then prints 8 recovery codes once. Write them down and keep them off the phone. The QR code, the key and the recovery codes are secrets: do not paste them into chat, a ticket or a saved log.

Once it is on, every sign-in needs the password and a code, with no trusted devices. A recovery code works once, in place of the app code. To replace the setup (new key, new recovery codes), run the command again. To turn it off, for example if the phone is lost and the recovery codes are gone:

```
docker compose exec api python -m app.cli.set_mfa --off
```

Codes depend on the host clock being right to within about 30 seconds; check that the host clock is synchronised. Sessions already signed in stay valid for up to an hour. To end them at once, change `TOKEN_SECRET` and run `docker compose up -d`. The update that adds this runs a database migration (`0016`), so take a fresh encrypted export first (section 7). The `segno` QR library is installed into the `api` image by the normal build; there is nothing extra to install.

## 5. Check it

```
curl -s http://127.0.0.1:8080/health          # {"status":"ok"}
docker compose ps                              # db, api and web: healthy
docker compose exec api alembic current        # prints the newest revision, marked (head)
docker port zeekr-companion-web-1              # the address and port you set
```

Then open `http://<host-address>:<WEB_PORT>` in a browser and sign in. If `WEB_BIND_ADDRESS` is still loopback, that works from the host only.

Optional full check from a development machine with the repo checked out: `infra/smoke.sh` starts a throwaway copy of the stack (own project name, own secrets, removed afterwards) and tests routing, headers, the body cap, network isolation and the login rate limit. It never touches the real stack or its data.

## 6. Reach it from a phone

Over plain HTTP, Safari on iPhone will open the app but gives no service worker, so no offline shell and no install to the Home Screen. For that you need HTTPS. The runbook for private HTTPS is in `infra/README.md`, "Owner runbook: private HTTPS with the Tailscale sidecar" (owner choice 2026-11-08, ADR-003 amendment). It is an optional `tailscale` service in the same compose file, switched on with `COMPOSE_PROFILES=tailscale` in `.env`; nothing is installed on the host. It **has not been run** on the owner's host or the Pi, so treat that runbook as unverified.

## 7. Update

1. If the new version has a database migration, take a fresh encrypted export first. Migrations run automatically when `api` starts, and the export is the rollback point. How to take and check one is in `infra/backup/RESTORE.md`, section "Off-machine backup". A change with no migration does not need one.
2. `git pull`
3. `cd infra && docker compose up -d --build --wait`
4. Check `/health`, `docker compose ps` and `docker compose exec api alembic current`.

This rebuilds `api` and `web` from the new code. `db` is left running and its data is kept. The old steps of building the client on a Mac, running `check-dist.sh` and copying it with `rsync` are no longer needed: the image build runs `infra/check-dist.sh` itself and fails if the build has no `index.html`, or has dotfiles or source maps.

## 8. Back up

The only backup is an encrypted copy pulled to the owner's Mac (owner decision 2026-10-27). The setup and the scripts are in `infra/backup/RESTORE.md`. A backup that was never restored is not a backup: run the restore check before relying on it.

## 9. Stop and roll back

- Stop, keep the data: `docker compose down`.
- Back to the previous version: `docker compose down`, check out the previous commit, `docker compose up -d --build --wait`. A migration is not undone this way. Use the pre-update export, restored into a throwaway database first (`infra/backup/RESTORE.md`).
- Never run `docker compose down -v`, `docker volume prune` or `docker volume rm zeekr-companion_pgdata` unless you mean to delete all the data.

## 10. Moving a host that used the old web setup

The old `web` container mounted `infra/Caddyfile`, `infra/snippets` and a `WEB_DIST_DIR` folder. The new compose file bakes all three into an image.

- Run the usual update (section 7). Compose recreates `web` from the new image. `api` and `db`, the volumes and the port are unchanged.
- A leftover `WEB_DIST_DIR` line in `.env` is ignored. You may delete it.
- The `dist` folder you used to copy to the host is no longer read. You may delete it.
- `WEB_BIND_ADDRESS`, `WEB_PORT` and `WEB_HSTS` keep their meaning.

## Install from published images (one file, ADR-012)

Images are published for every release from `v0.1.0`; the newest is `v0.1.10`. Use a released tag; there is no `latest`. What has and has not been checked is at the end of this section.

Needs a host with Docker Engine and the Compose plugin, on **x86_64** or **aarch64** (the images are `linux/amd64` and `linux/arm64` from the first release after 2026-11-07; releases up to `v0.1.3` are `linux/amd64` only). Check with `uname -m`. A 32-bit ARM system (`armv7l`) is not supported. On a Raspberry Pi 3 (1 GB of memory, not tested), use these published images; building there with `--build` is very slow and may run out of memory. For a 512 MB host, see "On a 512 MB host" below.

1. Make a folder and download three files into it from the repository: `infra/docker-compose.release.yml` (save it as `docker-compose.yml`), `infra/.env.example` and `infra/install.sh` (then `chmod +x install.sh`).
2. Run `./install.sh --version v0.1.0` (use the released tag you want). It writes `.env` with random secrets and the version. Never paste `.env` anywhere, and keep a private copy.
3. `docker compose up -d --wait`. It pulls the images, so there is no build and no `npm ci`.
4. Create the owner login: `docker compose exec api python -m app.cli.set_owner`. Optional second step: `docker compose exec api python -m app.cli.set_mfa` (see section 4).
5. Check it as in section 5.
6. To update: change `ZEEKR_VERSION` to the new tag, then `docker compose pull` and `docker compose up -d --wait`. To go back, set the old tag. A migration runs when `api` starts, so take a fresh encrypted export first when the release notes mention one (section 7).

Browser error reporting (`VITE_SENTRY_DSN`) is **off** in the published web image. To have it, install from a clone.

### On a 512 MB host (Raspberry Pi Zero 2 W)

The measured figures below come from the `arm64` images on the development Mac, with all containers sharing one memory limit and swap off (ADR-006 amendment 2026-11-09). What the owner reported from a real Pi is under "Reported on a Pi Zero 2 W" at the end of this section.

- **Release:** the first release **after `v0.1.11`**. Older API images ignore `PASSWORD_HASH_CONCURRENCY`, so a burst of sign-ins can still run them out of memory.
- **System:** a 64-bit OS. `uname -m` must print `aarch64`; `armv7l` (32-bit) is not supported. A Lite (no desktop) image leaves the most memory.
- **Install from images only**, as above. Never `--build` on the Pi.
- **Swap or zram is required.** The containers need about 288 MB at peak, and the OS and Docker need some of the 512 MB too (not measured). Check with `free -m`: the `Swap:` line must not be 0. How to set up swap or zram depends on the OS release; the repository does not give the commands.
- **Memory limits must work.** Run `docker info`. If it warns `No memory limit support`, the kernel has the memory cgroup off and the limits below are ignored. Turn it on as your OS's documentation says, then reboot.

Turn on the low-memory overlay:

1. Download `infra/docker-compose.lowmem.yml` into the same folder as `docker-compose.yml`.
2. Add this line to `.env`: `COMPOSE_FILE=docker-compose.yml:docker-compose.lowmem.yml`
3. `docker compose up -d --wait`. Every later `docker compose` command in that folder uses both files.
4. Check: `docker compose exec api printenv PASSWORD_HASH_CONCURRENCY` prints `1`.

What the overlay does (`infra/docker-compose.lowmem.yml`):

| Container   | Change                                   | Limit  | Measured                                                        |
| ----------- | ---------------------------------------- | ------ | --------------------------------------------------------------- |
| `db`        | small buffers, no parallel query workers | 96 MB  | about 44 MB peak                                                |
| `api`       | one password check at a time             | 288 MB | about 90 MB idle, about 220 MB during a sign-in                 |
| `web`       | none                                     | 64 MB  | about 31 MB peak                                                |
| `tailscale` | none                                     | 96 MB  | about 40 MB before tailnet sign-in; not measured once connected |

The result: with all containers sharing **288 MB**, 8 sign-ins at once and 1,500 requests all succeeded, with nothing killed. At 256 MB the API was killed. Without the overlay it needs about 400 MB. Sign-ins that arrive together now wait in line, so each one can take a few seconds longer. Nothing else in the app changes.

To turn it off, remove the `COMPOSE_FILE` line and run `docker compose up -d --wait`.

#### Reported on a Pi Zero 2 W

Owner-reported on 2026-11-09 from command output pasted in chat (not run by the agent):

- **System:** Debian 13 (trixie), `aarch64`, Docker Engine 29.9.3, Compose v5.7.0, cgroup version 2. The stack is `v0.1.12` with the overlay, Tailscale sidecar on; all four containers healthy after about an hour.
- **Only about 415 MiB is visible** (`free -m` and `docker info`), not 512 MB: the kernel and the graphics part keep the rest. About 144 MiB was available at idle.
- **Swap is zram** (`swapon --show`: `/dev/zram0`, 415 MiB), already set up on that system; about 149 MiB of it was in use at idle. zram is compressed memory, so it does not wear the SD card. Check yours with `swapon --show`; a swap file on the card works but is slower.
- **The limits took effect:** `docker stats` showed api 288 MiB, db 96 MiB, web 64 MiB and tailscale 96 MiB, and `PASSWORD_HASH_CONCURRENCY` printed `1`.
- **Idle use:** api about 22 MiB, db about 19 MiB, tailscale about 11 MiB, web about 6 MiB. These are lower than on the Mac because idle memory had moved into zram.
- **Not yet checked:** a sign-in on the Pi (the moment the API needs about 128 MB more), its time, and that no container was killed for memory afterwards (`RestartCount` and `OOMKilled` from `docker inspect`, and `dmesg`).

### Publishing a release (owner)

The images are built by the GitHub Actions workflow `.github/workflows/release-images.yml`. It runs only when a version tag is pushed. It never runs on a push to `main`. It uses GitHub's built-in token, so there is no secret to store.

1. Run all the quality gates on the commit to release.
2. Tag and push: `git tag v0.1.0` then `git push origin v0.1.0`. The tag must look like `vN.N.N`.
3. Watch the run on the repository's Actions page. It builds both images, checks that the web image has no dotfiles or source maps and the API image has no env or key files, and only then pushes them.
4. **First release only:** a new package starts private. On GitHub, open each of the two packages (`zeekr-companion-api` and `zeekr-companion-web`), then Package settings, and set the visibility to public. Link them to the repository if GitHub offers it. A public package can be pulled with no login.
5. On a host, test the install above.

### What is not verified for this install

Checked on 2026-11-08, from the Mac:

- The workflow ran for every tag from `v0.1.0` to `v0.1.10`, and every run succeeded.
- For `v0.1.10`, both `zeekr-companion-api` and `zeekr-companion-web` list `linux/amd64` and `linux/arm64`, and the registry hands them out without a login, so the packages are public.
- The `v0.1.10` web image holds the built client.

Not checked by the agent:

- A fresh install from these images on a clean host, following the steps above.
- An update on the owner's arm64 host. The owner reports the app working there on `v0.1.10`; the commands and their output were not shown.
- GitHub says the Container registry is "currently free" and promises a month's notice before that changes.

## What is verified and what is not

- Verified on the development machine: the compose file validates, the web image builds, the image holds the real client and no dotfiles or source maps, and `infra/smoke.sh` passes against the stack (62 checks).
- **Not run:** a fresh install on a clean Ubuntu host following this guide, a build on the owner's host (time, memory, disk), switching the owner's running host to the new web image, and any iPhone check.
