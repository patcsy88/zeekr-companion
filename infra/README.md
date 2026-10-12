# infra

Docker Compose stack: `db` (PostgreSQL), `api` (FastAPI) and `web` (Caddy: static client + reverse proxy).

```
cp .env.example .env     # fill in POSTGRES_PASSWORD, OWNER_PASSWORD_HASH, TOKEN_SECRET
docker compose up --build
```

- Only `web` publishes a port: `${WEB_BIND_ADDRESS:-127.0.0.1}:${WEB_PORT:-8080}`. Never default it to `0.0.0.0`. `api` and `db` have no `ports`.
- `web` forwards `/api/*` and `/health` to `api:8000`; everything else is static files from `/srv/web` with fallback to `index.html`.
- **Wiring `apps/web`:** run `npm run build` in `apps/web`, then set `WEB_DIST_DIR=../apps/web/dist` in `infra/.env` (path relative to `infra/`). Until then a placeholder page in `infra/web-placeholder` is served.
- **Headers** (`Caddyfile`): CSP, `nosniff`, `Referrer-Policy: no-referrer` on every response; `no-cache` on `index.html`, `sw.js` and fallback routes; `no-store` on `/api/*`; request body cap 64 KiB (answered as `400 validation_error`, matching the API).
- **HSTS** is off. `WEB_HSTS=on` adds `Strict-Transport-Security` (30 days). Set it only once HTTPS exists. No TLS, certificate or remote-access tool is configured; none has been chosen.
- **Client address / login rate limit:** the proxy has a fixed address (`WEB_PROXY_IP` in `WEB_SUBNET`). `api` starts uvicorn with `--proxy-headers --forwarded-allow-ips $FORWARDED_ALLOW_IPS`, set to that address only. The entrypoint refuses `*`. Caddy overwrites any client-sent `X-Forwarded-For`.
- **Networks:** `backend` is `internal: true` (no route out) and holds `db`, `api` and `web`; `edge` holds only `web` and carries the published port. `web` is the only service on both.
- **Post-build check:** after `npm run build` in `apps/web`, run `infra/check-dist.sh ../apps/web/dist`. It fails if `dist` has no `index.html`, or contains dotfiles or `.map` files. The proxy also answers 404 for any path with a dotfile segment or ending `.map`. `infra/smoke.sh` fails if `WEB_DIST_DIR` is set but `/` is still the placeholder: `SMOKE_WEB_DIST_DIR=../apps/web/dist infra/smoke.sh` tests the real build.
- **CSP** also has `form-action 'self'`. `Permissions-Policy` denies camera, microphone, geolocation, payment and USB, and `Cross-Origin-Opener-Policy: same-origin` is set; the real build was loaded in Chromium under these headers and signed in with no violations.
- **`Cache-Control` on `/api/*`:** the API sets `no-store`; Caddy adds it only if the response lacks one, so it is never duplicated.
- **Trusted proxies:** `FORWARDED_ALLOW_IPS` must be single addresses or networks no wider than IPv4 /24 or IPv6 /120; `0.0.0.0`, `0.0.0.0/0`, `::/0` and `*` stop the container at start (exit 64).
- **Smoke test:** `infra/smoke.sh` (unique project name, throwaway env and secrets, removes everything it created; never touches `zeekr-companion_pgdata`).
