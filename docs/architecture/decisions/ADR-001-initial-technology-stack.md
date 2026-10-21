# ADR-001: Initial technology stack

- Status: Accepted (owner approval 2026-10-11)
- Date: 2026-10-10

## Context

A single owner wants a personal iOS-first app for a Zeekr 7X (now a mobile web app, see ADR-002), backed by a server on their own homelab. Vehicle connectivity is unverified, so the product must work from manual records. The code is written with AI-agent assistance in OpenCode.

## Decision

| Layer | Choice |
|---|---|
| Mobile | React Native + Expo + TypeScript |
| API | Python + FastAPI |
| Database | PostgreSQL, with Alembic migrations |
| Deployment | Docker Compose on Unraid |
| Integrations | Adapter interfaces, none in the MVP |
| Development harness | OpenCode with project-scoped agents |

## Options considered

- **Native Swift:** best iOS integration, but no Android path and a separate language.
- **Local-only app with no backend:** simplest, but offers no server-side backup, and the owner chose self-hosting.
- **Node/TypeScript backend:** one language across the stack, but Python is preferred for later document and AI work.
- **SQLite on the server:** simpler, but PostgreSQL is the owner's recommended direction and handles future growth.

## Consequences

- One TypeScript codebase serves iOS now and Android later.
- Two languages in the repository: TypeScript and Python.
- The owner operates the server: uptime, backups, TLS and remote access.
- Shared types need discipline to stay aligned between Python and TypeScript. The OpenAPI schema is the source for generated types.
- No LangGraph, vector database or autonomous agent in the first release. Revisit if a requirement emerges.

## Open items

- Remote access method (pending owner approval).
- ~~Apple Developer account for device builds.~~ Resolved 2026-10-22: not needed. ADR-002 replaced the native client with a PWA.
