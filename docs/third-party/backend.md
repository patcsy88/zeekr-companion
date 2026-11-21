# Backend (Python) components

Declared in `services/api/pyproject.toml`. Versions are what was installed on 2026-11-21. "Pinned" means an exact `==` version in `pyproject.toml`; the others use a minimum version.

## In the `api` image

| Component           | Version | Licence                    | Used for                                      | Pinned | Notes                                                                                                                                                     |
| ------------------- | ------- | -------------------------- | --------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fastapi             | 0.143.0 | MIT                        | The API                                       | no     |                                                                                                                                                           |
| uvicorn             | 0.54.0  | BSD-3-Clause               | Web server for the API                        | no     |                                                                                                                                                           |
| sqlalchemy          | 2.1.4   | MIT                        | Database access                               | no     |                                                                                                                                                           |
| alembic             | 1.20.0  | MIT                        | Database migrations                           | no     |                                                                                                                                                           |
| psycopg             | 3.3.6   | LGPL-3.0                   | Postgres driver                               | no     | Used unmodified as a library.                                                                                                                             |
| psycopg-binary      | 3.3.6   | LGPL-3.0                   | Compiled part of the Postgres driver          | no     | Installed through `psycopg[binary]`.                                                                                                                      |
| pydantic            | 2.14.0  | MIT                        | Data validation                               | no     |                                                                                                                                                           |
| pydantic-settings   | 2.15.0  | MIT                        | Reading `.env` settings                       | no     |                                                                                                                                                           |
| sentry-sdk          | 2.73.0  | MIT                        | Optional API error reporting                  | no     | Off unless `SENTRY_DSN_API` is set (ADR-007).                                                                                                             |
| langchain-anthropic | 1.7.7   | MIT                        | Optional advisory explanations                | yes    | Model is off by default (ADR-008).                                                                                                                        |
| langsmith           | 0.14.16 | MIT                        | Optional tracing of those calls               | yes    | Off by default (ADR-008).                                                                                                                                 |
| zeekr-ev-api        | 0.1.15  | MIT                        | Live car data and the Sentry command          | yes    | By Fryyyyy. Unofficial, single maintainer. The package's own licence field is empty; MIT is from the sdist `LICENSE` file. Approved 2026-10-30 (ADR-009). |
| pycryptodome        | 3.24.1  | BSD and public domain      | Encryption used by `zeekr-ev-api`             | no     | Comes with `zeekr-ev-api`.                                                                                                                                |
| segno               | 1.6.6   | BSD                        | QR code for the authenticator setup           | yes    | Approved 2026-11-06 (ADR-013).                                                                                                                            |
| pywebpush           | 2.5.0   | MPL-2.0                    | Sends push notifications                      | yes    | Approved 2026-11-20 (ADR-014). Used unmodified.                                                                                                           |
| py-vapid            | 1.9.6   | MPL-2.0                    | Signs push requests                           | no     | Comes with `pywebpush`. The package's own licence field is empty; MPL-2.0 is as recorded in ADR-014.                                                      |
| cryptography        | 50.0.2  | Apache-2.0 or BSD-3-Clause | Encryption used by `pywebpush` and `py-vapid` | no     | Comes with `pywebpush`.                                                                                                                                   |

## Dev tools (not in the image)

| Component  | Version | Licence    | Used for                 |
| ---------- | ------- | ---------- | ------------------------ |
| pytest     | 9.1.1   | MIT        | Tests                    |
| pytest-cov | 7.1.0   | MIT        | Coverage (floor 95%)     |
| httpx      | 0.28.1  | BSD        | Test client              |
| ruff       | 0.17.0  | MIT        | Lint and format          |
| mypy       | 2.4.0   | MIT        | Type checks              |
| pip-audit  | 2.10.1  | Apache-2.0 | Known-vulnerability scan |

## Also pulled in by the full tree (not direct)

| Component | Licence                         | Note                                                    |
| --------- | ------------------------------- | ------------------------------------------------------- |
| certifi   | MPL-2.0                         | Used unmodified; also named in `pyproject.toml` dev set |
| orjson    | MPL-2.0 AND (Apache-2.0 OR MIT) | Used unmodified                                         |
| pathspec  | MPL-2.0                         | Used unmodified                                         |
