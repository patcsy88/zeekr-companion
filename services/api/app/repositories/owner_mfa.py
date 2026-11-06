from __future__ import annotations

import datetime as dt
from typing import Any, cast

from sqlalchemy import CursorResult, delete, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import OwnerMfa


class OwnerMfaRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get(self) -> OwnerMfa | None:
        return self._session.scalars(select(OwnerMfa)).first()

    def replace(self, secret: str, last_step: int, recovery_hashes: list[str]) -> None:
        """Turn MFA on, or replace the secret and recovery codes of the existing setup."""
        now = dt.datetime.now(dt.UTC)
        values = {
            "secret": secret,
            "last_step": last_step,
            "recovery_hashes": recovery_hashes,
            "updated_at": now,
        }
        stmt = pg_insert(OwnerMfa).values(id=1, created_at=now, **values)
        self._session.execute(stmt.on_conflict_do_update(index_elements=[OwnerMfa.id], set_=values))
        self._session.commit()

    def remove(self) -> bool:
        result = cast("CursorResult[Any]", self._session.execute(delete(OwnerMfa)))
        removed = result.rowcount > 0
        self._session.commit()
        return removed

    def accept_step(self, step: int) -> bool:
        """Record `step` as used. False if a newer or equal step is already recorded (another
        request got there first), so two parallel logins cannot both use one code."""
        result = cast(
            "CursorResult[Any]",
            self._session.execute(
                update(OwnerMfa)
                .where(OwnerMfa.id == 1, OwnerMfa.last_step < step)
                .values(last_step=step)
            ),
        )
        self._session.commit()
        return result.rowcount == 1

    def use_recovery(self, stored_hash: str) -> bool:
        """Remove one recovery hash. False if it was already gone (used by a parallel request)."""
        row = self.get()
        if row is None or stored_hash not in row.recovery_hashes:
            return False
        remaining = [h for h in row.recovery_hashes if h != stored_hash]
        result = cast(
            "CursorResult[Any]",
            self._session.execute(
                update(OwnerMfa)
                .where(OwnerMfa.id == 1, OwnerMfa.recovery_hashes == row.recovery_hashes)
                .values(recovery_hashes=remaining, updated_at=dt.datetime.now(dt.UTC))
            ),
        )
        self._session.commit()
        return result.rowcount == 1
