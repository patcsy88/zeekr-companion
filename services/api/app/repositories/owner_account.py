from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import OwnerAccount


class OwnerAccountRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get(self) -> OwnerAccount | None:
        return self._session.scalars(select(OwnerAccount)).first()

    def upsert(self, username: str, password_hash: str) -> OwnerAccount:
        """Create the account, or replace the username and hash of the existing one."""
        now = dt.datetime.now(dt.UTC)
        values = {"username": username, "password_hash": password_hash}
        stmt = pg_insert(OwnerAccount).values(id=uuid.uuid4(), singleton=True, **values)
        stmt = stmt.on_conflict_do_update(
            index_elements=[OwnerAccount.singleton], set_={**values, "updated_at": now}
        )
        row = self._session.execute(
            stmt.returning(OwnerAccount).execution_options(populate_existing=True)
        ).scalar_one()
        self._session.commit()
        return row
