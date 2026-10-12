"""Validate FORWARDED_ALLOW_IPS before the API starts (used by docker-entrypoint.sh).

uvicorn believes X-Forwarded-For only from the listed peers. A wide range (0.0.0.0/0, ::/0, a /8)
would let arbitrary callers pick their own login rate-limit bucket, so only single hosts and small
networks are accepted: IPv4 /24 or narrower, IPv6 /120 or narrower. The proxy subnet is a /24.

Usage: python -m app.cli.check_trusted_proxies "$FORWARDED_ALLOW_IPS"   (exit 64 when rejected)
"""

from __future__ import annotations

import ipaddress
import sys

MIN_PREFIX_V4 = 24
MIN_PREFIX_V6 = 120

_Network = ipaddress.IPv4Network | ipaddress.IPv6Network


def parse_trusted_proxies(value: str) -> list[_Network]:
    """Return the networks in a comma-separated list, or raise ValueError naming the bad entry."""
    entries = [item.strip() for item in value.split(",")]
    if not any(entries):
        raise ValueError("FORWARDED_ALLOW_IPS is empty; list the proxy address explicitly")
    networks: list[_Network] = []
    for entry in entries:
        if not entry:
            raise ValueError("FORWARDED_ALLOW_IPS contains an empty entry")
        try:
            network = ipaddress.ip_network(entry, strict=False)
        except ValueError:
            raise ValueError(
                f"FORWARDED_ALLOW_IPS entry {entry!r} is not an IP address or CIDR network"
            ) from None
        minimum = MIN_PREFIX_V4 if network.version == 4 else MIN_PREFIX_V6
        if network.network_address.is_unspecified or network.prefixlen < minimum:
            raise ValueError(
                f"FORWARDED_ALLOW_IPS entry {entry!r} is too wide; trust a single proxy address "
                f"or a network no larger than /{minimum} (never 0.0.0.0/0, ::/0 or '*')"
            )
        networks.append(network)
    return networks


def main(argv: list[str]) -> int:
    value = argv[1] if len(argv) > 1 else ""
    try:
        parse_trusted_proxies(value)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 64
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
