#!/bin/sh
# Apply migrations (idempotent), then start the API. Fails fast if migrations fail.
#
# FORWARDED_ALLOW_IPS lists the only peers whose X-Forwarded-For / X-Forwarded-Proto uvicorn
# believes (the reverse proxy container). It must be an explicit IP or CIDR list: a wildcard would
# let any caller choose its own rate-limit bucket, and so would any wide network. When unset, only
# loopback is trusted.
set -eu

trust="${FORWARDED_ALLOW_IPS:-127.0.0.1}"
case "$trust" in
  *'*'*)
    echo "FORWARDED_ALLOW_IPS must list explicit proxy addresses, never '*'." >&2
    exit 64
    ;;
esac

# Rejects 0.0.0.0, 0.0.0.0/0, ::/0 and any network wider than IPv4 /24 or IPv6 /120.
python -m app.cli.check_trusted_proxies "$trust" || exit 64

alembic upgrade head
exec uvicorn app.asgi:app --host 0.0.0.0 --port 8000 --no-server-header \
  --limit-concurrency 64 --proxy-headers --forwarded-allow-ips "$trust"
