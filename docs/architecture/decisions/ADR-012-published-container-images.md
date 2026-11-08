# ADR-012: Published container images on ghcr.io

- Status: Accepted (owner approval in chat, 2026-11-06). Not yet run: no image has been published.
- Date: 2026-11-06

Labels: **confirmed** (read from a source or stated by the owner), **proposed**, **unverified**.

## Context

- **confirmed** Today the stack is built on the host from a full `git clone` (`docs/operations/deploy-guide.md`). The compose file alone cannot start the app, because `api` and `web` have only `build:` sections.
- **confirmed** The owner wants a one-file install, and answered: use a registry (yes), pick the most sensible one (agent's choice), public images with browser error reporting off (yes), host CPU `x86_64`.
- **confirmed** `AGENTS.md` makes a new external service an approval gate. The owner approved GitHub's container registry (`ghcr.io`) and a GitHub Actions workflow on 2026-11-06.
- **confirmed** (GitHub Docs, "About billing for GitHub Packages", read 2026-11-06) Packages are free for public packages. Container registry storage and bandwidth are "currently free", with at least one month's notice before that changes. That is a current policy, not a promise.
- **confirmed** (Docker Docs, "Docker Hub usage and limits", read 2026-11-06) Docker Hub's free plan allows 200 pulls per 6 hours signed in and 100 per IP address signed out, and 1 private repository.

## Decision

1. **Registry:** `ghcr.io`, under the owner's existing GitHub account. No new account. Docker Hub was compared and not chosen: it needs a new account and has a pull limit, with no advantage here.
2. **Images:** `zeekr-companion-api` (from `services/api/Dockerfile`) and `zeekr-companion-web` (from `infra/web.Dockerfile`, build context the repository root). **Public.** Only the owner makes a package public, once, on GitHub's package page after the first push; a new package starts private.
3. **Build:** GitHub Actions, run only when a version tag of the form `vN.N.N` is pushed. It never runs on a push to `main`, so publishing is a deliberate step. The workflow uses the built-in `GITHUB_TOKEN` with `packages: write` and `contents: read` only. No personal access token and no stored secret.
4. **CPU type:** `linux/amd64` only, because the owner's host is `x86_64`. The images will not run on an arm64 host. **Amended 2026-11-07, see below:** `linux/amd64` and `linux/arm64`.
5. **Tags:** the version tag only (for example `v0.2.0`). No `latest`, so a deploy names a version and a rollback is a version change.
6. **No secrets in the images.** The published `web` image is built with `VITE_SENTRY_DSN` empty, so browser error reporting is off in it (owner choice). The workflow checks each image for dotfiles and source maps before it pushes.
7. **Compose:** a separate, standalone `infra/docker-compose.release.yml` with `image:` lines and no `build:`. It is the one file to download. `infra/docker-compose.yml` is unchanged, so the owner's current host and development keep working. `ZEEKR_VERSION` in `.env` is required, with no default. A script, `infra/check-release-compose.sh`, fails if the two files drift in their service settings.
8. **Pulling needs no login** once the packages are public. Pushing is done only by the workflow. The agent holds no registry credential.

## Consequences

- A new host needs the release compose file, a `.env`, and `docker compose up -d`. No clone, no build, no `npm ci`.
- Browser error reporting stays off in published images. An owner who wants it builds locally with the existing compose file.
- A tag push publishes. A wrong tag publishes a wrong image, so a tag should be pushed only after the gates pass.
- The workflow has published every release since `v0.1.0` (see Not verified for what is still unchecked).

## Not verified

- A fresh install from the images on a clean host. On the owner's arm64 host, the owner reports the app working on `v0.1.10` (owner-reported, not seen by the agent).

Checked on 2026-11-08: the workflow ran for every tag from `v0.1.0` to `v0.1.10`, and every run succeeded. For `v0.1.10`, both packages list `linux/amd64` and `linux/arm64`, and they can be pulled without a login.
- That the free container registry terms stay free.

## Revisit when

- GitHub announces billing for the Container registry.
- A second CPU type is needed (add `linux/arm64` to the workflow).
- The owner wants browser error reporting in the published image (a build argument from a repository variable, a separate decision).

## Amendment: arm64 images (owner approval 2026-11-07)

- **confirmed** The owner wants the app to also run on a Raspberry Pi 3 and reported `uname -m` on it as `aarch64` (a 64-bit OS). The owner chose "publish them" over building on the Pi or copying images by hand.
- **confirmed** (checked 2026-11-07 on the agent's arm64 Mac) `services/api/Dockerfile` and `infra/web.Dockerfile` build unchanged for `linux/arm64`. In the API image `platform.machine()` is `aarch64`, and psycopg (binary), pydantic-core, zstandard, orjson, segno, langchain-anthropic, zeekr-ev-api and `app.main` import. The web image runs Caddy v2.11.7. `postgres:17-alpine` publishes `arm64/v8`.
- **confirmed** 32-bit ARM is not supported: `node:26.13-alpine` has no `arm/v7` image, and psycopg-binary and zstandard have no `armv7l` wheels for the pinned versions (PyPI, read 2026-11-07).
- **confirmed** (GitHub changelog 2025-08-07, "arm64 hosted runners for public repositories are now generally available") `ubuntu-24.04-arm` runners are free in public repositories. This repository is public. They do not work in a private repository: making the repository private would break the arm64 build.

Decision:

1. The workflow builds each CPU type natively on its own GitHub-hosted runner (`ubuntu-latest` for amd64, `ubuntu-24.04-arm` for arm64). No QEMU emulation and no new action: only the actions already pinned are used.
2. Each runner checks its images (no dotfiles, source maps or env files; the expected CPU type; the API's compiled packages import; Caddy starts), then pushes `<version>-amd64` or `<version>-arm64`.
3. A last job joins them under the plain version tag with `docker buildx imagetools create`. A host pulling `<version>` gets the image for its own CPU type. If either build fails, the plain version tag is not created. Still no `latest`.
4. The `-amd64` and `-arm64` tags are visible on the package page as a side effect. Hosts should use the plain version tag.
5. `infra/docker-compose.release.yml` is unchanged apart from its comment: the same `image:` lines work on both CPU types.

Not verified:

- The changed workflow has not run. It runs on the next version tag, which only the owner asks for ("Release package").
- Nothing has run on the Raspberry Pi 3. Its 1 GB of memory is the main risk for running PostgreSQL, the API and Caddy together (an estimate, not measured). An SD card wears under database writes; a USB SSD is advised.
- The host scripts (`infra/backup/`, the systemd templates) were not checked on a Pi.
- The Pi as a host is not an ADR-004 decision (Ubuntu Server 24.04 on homelab hardware). Running the app there is the owner's choice; the ADR-004 firewall, backup and Tailscale notes apply in the same way.

