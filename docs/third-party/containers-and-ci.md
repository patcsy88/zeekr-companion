# Containers, CI and scanners

Versions are read from the repo files (2026-11-21). **The licences in this file are unverified:** they come from general knowledge, not from the projects. Check them before relying on them.

## Docker images

| Component | Version in the repo                             | Licence (unverified) | Used for                           | Declared in                                                                                              |
| --------- | ----------------------------------------------- | -------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| python    | `3.13-slim`                                     | PSF                  | Base of the `api` image            | `services/api/Dockerfile`                                                                                |
| node      | `26.13-alpine`                                  | MIT                  | Builds the web client              | `infra/web.Dockerfile`                                                                                   |
| caddy     | `2.11-alpine`                                   | Apache-2.0           | Serves the web client              | `infra/web.Dockerfile`                                                                                   |
| postgres  | `17-alpine`                                     | PostgreSQL licence   | The database                       | `infra/docker-compose.yml`, `infra/docker-compose.release.yml`                                           |
| tailscale | `v1.104.4`                                      | BSD-3-Clause         | Optional private HTTPS sidecar     | `infra/docker-compose.yml`, `infra/docker-compose.release.yml`                                           |
| pgvector  | `pg16` (throwaway test database, never shipped) | PostgreSQL licence   | API tests (a disposable container) | Not in the repo. Run by hand; the tests only read `TEST_DATABASE_URL` (`services/api/tests/conftest.py`) |

## GitHub Actions

| Component                   | Version in the repo        | Licence (unverified) | Used for                     | Declared in                       |
| --------------------------- | -------------------------- | -------------------- | ---------------------------- | --------------------------------- |
| actions/checkout            | v6 (pinned by commit)      | MIT                  | Gets the code                | `release-images.yml`, `trivy.yml` |
| docker/setup-buildx-action  | v4.4.1 (pinned by commit)  | Apache-2.0           | Builds the images            | `release-images.yml`              |
| docker/login-action         | v4.8.0 (pinned by commit)  | Apache-2.0           | Signs in to GHCR             | `release-images.yml`              |
| docker/build-push-action    | v7.4.0 (pinned by commit)  | Apache-2.0           | Builds and pushes the images | `release-images.yml`              |
| aquasecurity/trivy-action   | v0.36.0 (pinned by commit) | Apache-2.0           | Image scan                   | `trivy.yml`                       |
| github/codeql-action        | v4.39.3 (pinned by commit) | MIT                  | Uploads scan results         | `trivy.yml`                       |
| semgrep (`semgrep/semgrep`) | image, no version pinned   | LGPL-2.1             | Code scan                    | `semgrep.yml`                     |

## Other tools used by hand

| Component | Used for                       | Note                                                          |
| --------- | ------------------------------ | ------------------------------------------------------------- |
| gitleaks  | Secret scan before each commit | Config in `.gitleaks.toml`. Version not recorded in the repo. |
| CodeQL    | Code scan on GitHub            | Run by GitHub (default setup), not declared in the repo.      |

## Optional hosted services (off by default)

| Service                          | Used for                          | Decision         |
| -------------------------------- | --------------------------------- | ---------------- |
| Sentry                           | Error reporting (API and browser) | ADR-007          |
| Anthropic API                    | Advisory explanations             | ADR-008          |
| LangSmith                        | Tracing of those calls            | ADR-008          |
| Zeekr app interface (unofficial) | Live car data and Sentry command  | ADR-009, ADR-010 |
| Phone maker's push service       | Delivering push notifications     | ADR-014          |
| Firecrawl (free tier)            | Research only, never in the app   | ADR-005          |
