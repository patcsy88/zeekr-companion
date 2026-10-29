"""Replaceable interfaces to external vehicle and document sources.

`telemetry` holds the read-only vehicle telemetry port (ADR-008) and its only provider, which is
built on records the owner already entered. A live adapter must be backed by a `verified` entry in
docs/research/vehicle-integrations.md, its own ADR and the owner's approval.
"""
