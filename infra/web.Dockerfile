# Web image: builds the React client, checks it, and serves it with Caddy.
# Build context is the repository root (the client imports packages/shared-types):
#   docker build -f infra/web.Dockerfile .      (compose does this for you)
# Optional build argument VITE_SENTRY_DSN turns on browser error reporting (ADR-007); empty is off.

# Node 26.12.1 and later carry the Brotli decoder fix (CVE-2026-111497); keep this at 26.13 or newer.
FROM node:26.13-alpine AS build
RUN apk add --no-cache bash
WORKDIR /repo

COPY apps/web/package.json apps/web/package-lock.json apps/web/
RUN cd apps/web && npm ci

COPY packages/shared-types packages/shared-types
COPY apps/web apps/web
COPY infra/check-dist.sh infra/check-dist.sh

ARG VITE_SENTRY_DSN=
ENV VITE_SENTRY_DSN=${VITE_SENTRY_DSN}
RUN cd apps/web && npm run build
# Fails the build if dist has no index.html, or has dotfiles or source maps.
RUN cd infra && ./check-dist.sh ../apps/web/dist

FROM caddy:2.11-alpine
COPY infra/Caddyfile /etc/caddy/Caddyfile
COPY infra/snippets /etc/caddy/snippets
COPY --from=build /repo/apps/web/dist /srv/web
