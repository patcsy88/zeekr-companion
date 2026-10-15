# ADR-004: Standalone Ubuntu Server replaces Unraid as the host

- Status: Accepted (owner decision, 2026-10-15)
- Date: 2026-10-15
- Amends: ADR-001 (`Deployment | Docker Compose on Unraid`), ADR-003 (host-specific wording and the open "Unraid Tailscale plugin" question)

## Context

ADR-001 chose Docker Compose on Unraid as the deployment target, as part of the owner's existing homelab. The owner has since decided to move the server workload off Unraid and onto a standalone Ubuntu Server instead: self-hosted hardware or a VM the owner controls, on their own network, with no new external paid service. This is a substrate change only.

Reasons the owner gave for the move (stated generically, not re-litigated here):

- Simpler, more standard Linux administration: a mainstream distribution with conventional package management, systemd and documentation, rather than a NAS-oriented OS and plugin ecosystem.
- No NAS-specific abstraction (Unraid's array, parity, shares and plugin system) between the owner and the Docker/Tailscale installs.
- Full control over networking and firewall configuration directly through the Linux host (`ufw`, `systemd`, `iptables`/`nftables`), rather than through Unraid's own UI and plugin layer.

Nothing about the application architecture, the product requirements or the previously accepted remote-access design (ADR-003) is in question here. `infra/docker-compose.yml` and its three services (`db`, `api`, `web`) are unchanged.

## Decision

1. **Host OS: Ubuntu Server 24.04 LTS** (confirmed by the owner, 2026-10-15), self-hosted on hardware or a VM the owner owns and controls (homelab principle unchanged from ADR-001: no cloud provider, no paid VPS, no new external paid service).
2. **Docker Engine + the Docker Compose plugin**, installed from the official Docker apt repository (`docs.docker.com` instructions for Ubuntu), not a NAS vendor's bundled Docker build. The existing `infra/docker-compose.yml` stack (`db`, `api`, `web`) runs unchanged.
3. **Tailscale installed from the official Tailscale apt repository** and run as a systemd service (`tailscaled`, enabled and started via `systemctl`). `tailscale serve` is invoked exactly as designed in ADR-003, now always through the plain CLI, because there is no Unraid plugin ecosystem to choose between. This resolves ADR-003's previously open item: "Unraid Tailscale plugin or the plain CLI" is retired as plain CLI/systemd, unconditionally.
4. **Backups via `pg_dump`** to a location off the host: an external disk, a NAS share mounted over the network, or an offsite destination. The owner chooses the specific target; this ADR does not mandate one, because Ubuntu has no built-in "array" concept to default to.
5. **Firewall: `ufw` (or an equivalent host firewall) is the explicit perimeter**, with the following posture (SSH exposure confirmed by the owner, 2026-10-15: LAN-only):
   - Deny incoming by default (`ufw default deny incoming`).
   - Allow SSH (`tcp:22`) from the LAN subnet only (a placeholder CIDR in docs, e.g. `<LAN-SUBNET>/24`, not the real address range). SSH is **not** reachable from the Tailscale tailnet and **not** reachable from the public internet, and it is **not** disabled.
   - Allow whatever ports/interfaces the Tailscale/Caddy stack needs for the app path per ADR-003 (i.e. the app is reached over the tailnet via `tailscale serve`, not via a LAN-exposed port).
   - Nothing else inbound.

   There is no Unraid web UI providing an implicit management layer any more, so the firewall step is now an explicit, required part of setup rather than something the NAS vendor pre-configured.

## Options considered

- **Stay on Unraid:** no migration effort, but the owner wants to move off it for the reasons above; rejected by owner decision.
- **Standalone Ubuntu Server (chosen):** standard Linux administration, official apt repositories for Docker and Tailscale, systemd-managed services, explicit firewall. Matches the "self-hosted on own hardware" principle unchanged from ADR-001.
- **A different self-hosted NAS/hypervisor OS (e.g. Proxmox, TrueNAS):** not requested by the owner; out of scope. Ubuntu Server is the owner's stated choice.
- **Managed cloud VPS:** rejected; would introduce a new paid external service, contrary to the homelab principle carried over from ADR-001 and the "no new external paid service" constraint stated by the owner for this change.

## Consequences

- No Unraid array or parity concept exists on Ubuntu. Disk layout, data volume location and the backup target are the owner's choice, expressed as a plain filesystem path or a mounted volume (e.g. a second disk, an external USB drive, or an NFS/SMB mount). `infra/README.md` and any backup script must reference a configurable path, not an Unraid-specific array path.
- `ufw` (or an equivalent) becomes an explicit, required firewall layer during setup. Previously Unraid's own admin UI and its implicit network posture were part of the mental model; on a plain Ubuntu host nothing is pre-configured, so the firewall rules must be set up deliberately and documented in `infra/README.md` (infra engineer follow-up, out of this ADR's scope).
- ADR-003's privacy and security section referenced "keep Unraid's own admin UI, SSH and shares off the tailnet path." On Ubuntu there is no Unraid admin UI. The equivalent, generalised concern is: **SSH and any other host admin surface must not be reachable from the tailnet policy** — same principle as before (do not let the tailnet policy expose anything beyond the app's `tcp:443`), just phrased for a plain Linux host instead of a NAS appliance.
- ADR-003's open question "Unraid Tailscale plugin or plain CLI" is now resolved, not merely deferred: always plain CLI/systemd, because Ubuntu has no Unraid plugin system. See ADR-003 for the updated wording.
- `infra/docker-compose.yml`, the API, the web client and the database schema are unaffected. This is purely a host/OS change.
- `AGENTS.md` and `docs/product/product-brief.md` both contain "homelab/Unraid" wording that should be updated to reflect the new host (see the Engineering Lead's note accompanying this change; out of this ADR's write scope).
- `infra/README.md` contains Unraid-specific operational wording (e.g. "Owner runbook: private HTTPS with Tailscale Serve on the Unraid host", `ss -ltnp` check "on the Unraid host") that a backend engineer should update to plain Ubuntu/systemd/apt/ufw wording in a follow-up task (out of this ADR's write scope; infra is not edited by the architect).
- With the Ubuntu version (24.04 LTS) and SSH posture (LAN-only) now confirmed, `infra/README.md` and any firewall ruleset script (`ufw` rules) can be written immediately against those two decisions. The PostgreSQL data path and `pg_dump` backup target remain unresolved (see Open questions, item 3): no backup script should be written, and no data-volume path should be hardcoded, until the owner picks one of the listed options.

## Open questions for the owner

1. ~~Confirm the Ubuntu LTS version to standardize on.~~ **Resolved (owner, 2026-10-15): Ubuntu Server 24.04 LTS.**
2. ~~Does the owner want SSH exposed on the LAN only, or disabled entirely?~~ **Resolved (owner, 2026-10-15): LAN-only** — SSH is reachable from the LAN, not from the tailnet, not from the public internet, and not disabled. See Decision item 5 for the resulting `ufw` posture.
3. **PostgreSQL data path and `pg_dump` backup target — still open.** The owner has not yet picked a location (stated "no idea" as of 2026-10-15). This ADR does not default to one; instead it lays out low-effort options for the owner to choose between:
   - **(a) A second local disk or external USB drive**, mounted at a fixed path on the Ubuntu host, with `pg_dump` writing there on a cron job or systemd timer. Lowest effort to set up (no network dependency); but it shares the same physical machine as the primary data, so it gives no protection if the host itself fails, is stolen, or the disk enclosure fails along with it. No ongoing cost beyond the drive itself (one-time, already-owned hardware assumed).
   - **(b) An existing NAS or network share**, mounted over NFS or SMB at a fixed path, same `pg_dump`-on-a-timer approach. Slightly more setup effort (network mount, credentials/permissions) but protects against the Ubuntu host's local disk failing, since the backup lives on separate hardware. No new cost if the NAS already exists on the owner's LAN.
   - **(c) An offsite destination**, e.g. a low-cost object-storage bucket (S3-compatible) or another always-on device outside the home network. Best protection (survives total loss of the home network/premises), but introduces a new external service and likely a recurring cost — **this option requires explicit owner approval before implementation**, per the human approval gate for new external services/paid dependencies.

   Trade-offs in short: (a) cheapest/fastest but no protection from host/site loss; (b) modest effort, protects against local disk failure, no extra cost if NAS exists; (c) best protection but needs owner sign-off due to cost/new-service implications. The final pick is explicitly left to the owner; no default is assumed, and no backup script should be written until a target is chosen.
