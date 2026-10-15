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

1. **Host OS: Ubuntu Server LTS**, self-hosted on hardware or a VM the owner owns and controls (homelab principle unchanged from ADR-001: no cloud provider, no paid VPS, no new external paid service).
2. **Docker Engine + the Docker Compose plugin**, installed from the official Docker apt repository (`docs.docker.com` instructions for Ubuntu), not a NAS vendor's bundled Docker build. The existing `infra/docker-compose.yml` stack (`db`, `api`, `web`) runs unchanged.
3. **Tailscale installed from the official Tailscale apt repository** and run as a systemd service (`tailscaled`, enabled and started via `systemctl`). `tailscale serve` is invoked exactly as designed in ADR-003, now always through the plain CLI, because there is no Unraid plugin ecosystem to choose between. This resolves ADR-003's previously open item: "Unraid Tailscale plugin or the plain CLI" is retired as plain CLI/systemd, unconditionally.
4. **Backups via `pg_dump`** to a location off the host: an external disk, a NAS share mounted over the network, or an offsite destination. The owner chooses the specific target; this ADR does not mandate one, because Ubuntu has no built-in "array" concept to default to.
5. **Firewall: `ufw` (or an equivalent host firewall) is the explicit perimeter**, configured to allow only what is needed locally (e.g. SSH from the LAN, if used) and to rely on Tailscale's tailnet policy (ADR-003) for remote access. There is no Unraid web UI providing an implicit management layer any more, so the firewall step is now an explicit, required part of setup rather than something the NAS vendor pre-configured.

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

## Open questions for the owner

1. Which filesystem path or mounted volume will hold the PostgreSQL data volume and the `pg_dump` backup target? (Answer stays out of the public repo if it reveals home-network specifics; use a placeholder in docs, same convention as ADR-003.)
2. Does the owner want SSH exposed on the LAN only, or disabled entirely in favour of a console/KVM for admin access? This affects the exact `ufw` ruleset, which is an infra engineer task, not decided here.
3. Confirm the Ubuntu LTS version to standardize on (not specified by the owner at the time of writing).
