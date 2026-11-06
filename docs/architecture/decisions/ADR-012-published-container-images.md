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
4. **CPU type:** `linux/amd64` only, because the owner's host is `x86_64`. The images will not run on an arm64 host.
5. **Tags:** the version tag only (for example `v0.2.0`). No `latest`, so a deploy names a version and a rollback is a version change.
6. **No secrets in the images.** The published `web` image is built with `VITE_SENTRY_DSN` empty, so browser error reporting is off in it (owner choice). The workflow checks each image for dotfiles and source maps before it pushes.
7. **Compose:** a separate, standalone `infra/docker-compose.release.yml` with `image:` lines and no `build:`. It is the one file to download. `infra/docker-compose.yml` is unchanged, so the owner's current host and development keep working. `ZEEKR_VERSION` in `.env` is required, with no default. A script, `infra/check-release-compose.sh`, fails if the two files drift in their service settings.
8. **Pulling needs no login** once the packages are public. Pushing is done only by the workflow. The agent holds no registry credential.

## Consequences

- A new host needs the release compose file, a `.env`, and `docker compose up -d`. No clone, no build, no `npm ci`.
- Browser error reporting stays off in published images. An owner who wants it builds locally with the existing compose file.
- A tag push publishes. A wrong tag publishes a wrong image, so a tag should be pushed only after the gates pass.
- The workflow and the release compose file are **untested against the real registry** until the owner pushes the first tag, makes the packages public, and pulls on a host.

## Not verified

- That the workflow runs: it has never run. Action versions were checked against their repositories only.
- That the packages link to the repository and can be made public, and that a pull works without a login.
- That the images start on the owner's host.
- That the free container registry terms stay free.

## Revisit when

- GitHub announces billing for the Container registry.
- A second CPU type is needed (add `linux/arm64` to the workflow).
- The owner wants browser error reporting in the published image (a build argument from a repository variable, a separate decision).
