# Third-party components

Every library, image and CI action this project uses that someone else wrote. Last checked: 2026-11-21 (release `v0.9.29`).

| File                                         | Covers                                               |
| -------------------------------------------- | ---------------------------------------------------- |
| [backend.md](backend.md)                     | Python packages: the `api` image and the dev tools   |
| [web.md](web.md)                             | npm packages: shipped in the app, and build and test |
| [containers-and-ci.md](containers-and-ci.md) | Docker images, GitHub Actions and scanners           |

## Rule: keep these tables current

When a change adds, removes, upgrades or re-pins a third-party component, update the matching table in the same change. That covers `services/api/pyproject.toml`, `apps/web/package.json`, the Dockerfiles, both compose files and `.github/workflows/`. A new component also needs the owner's approval first when it is a new external service or a paid dependency (`AGENTS.md`, approval gates).

## How the tables were made

- **Versions and licences (Python):** read from the installed packages in the local `api` environment (`importlib.metadata`).
- **Versions and licences (web):** read from `apps/web/package-lock.json`.
- **Containers and CI:** versions are read from the repo files. Licences there are **unverified** (written from general knowledge, not read from the projects). Check them before relying on them.
- **Direct only.** These tables list what the repo names directly. The full trees are about 109 Python and 688 npm packages (most are MIT, BSD or Apache). `pip-audit` and `npm audit` cover the full trees, and Trivy scans the images in CI.

## Licence notes

- **No GPL or AGPL** in anything shipped.
- **MPL-2.0** (file-level copyleft): `pywebpush`, `py-vapid`, and in the full tree `certifi`, `orjson` and `pathspec`. Used unmodified.
- **LGPL-3.0:** `psycopg` and `psycopg-binary`, used unmodified as a library.
- **Build and test only:** `lightningcss` and `axe-core` (MPL-2.0) and `caniuse-lite` (CC-BY-4.0) are in the npm tree but are not shipped in the app.
- **Empty licence field:** `zeekr-ev-api` and `py-vapid` show no licence in their package metadata, so scanners label them UNKNOWN. Their licences are recorded in the table notes with the source.
