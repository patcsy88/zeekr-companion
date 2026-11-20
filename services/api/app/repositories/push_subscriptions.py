from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import dataclass

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import PushSubscription


@dataclass(frozen=True)
class SavedSubscription:
    """A phone's address and keys. Sensitive: never log or return it."""

    id: uuid.UUID
    endpoint: str
    p256dh: str
    auth: str


class PushSubscriptionRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def count(self) -> int:
        n = self._session.scalar(select(func.count()).select_from(PushSubscription)) or 0
        self._session.rollback()
        return int(n)

    def all(self) -> list[SavedSubscription]:
        rows = self._session.scalars(
            select(PushSubscription).order_by(PushSubscription.created_at)
        ).all()
        out = [SavedSubscription(r.id, r.endpoint, r.p256dh, r.auth) for r in rows]
        self._session.rollback()
        return out

    def upsert(self, endpoint: str, p256dh: str, auth: str, now: dt.datetime, limit: int) -> str:
        """`created`, `updated` or `full`. A phone over the limit is refused, never swapped in."""
        try:
            row = self._session.scalars(
                select(PushSubscription).where(PushSubscription.endpoint == endpoint)
            ).first()
            if row is not None:
                row.p256dh, row.auth, row.failure_count = p256dh, auth, 0
                result = "updated"
            else:
                held = self._session.scalar(select(func.count()).select_from(PushSubscription))
                if (held or 0) >= limit:
                    self._session.rollback()
                    return "full"
                self._session.add(
                    PushSubscription(
                        id=uuid.uuid4(),
                        endpoint=endpoint,
                        p256dh=p256dh,
                        auth=auth,
                        created_at=now,
                        failure_count=0,
                    )
                )
                result = "created"
            self._session.commit()
            return result
        except Exception:
            self._session.rollback()
            raise

    def delete_endpoint(self, endpoint: str) -> None:
        try:
            self._session.execute(
                delete(PushSubscription).where(PushSubscription.endpoint == endpoint)
            )
            self._session.commit()
        except Exception:
            self._session.rollback()
            raise

    def record_success(self, sub_id: uuid.UUID, now: dt.datetime) -> None:
        try:
            row = self._session.get(PushSubscription, sub_id)
            if row is not None:
                row.last_success_at, row.failure_count = now, 0
            self._session.commit()
        except Exception:
            self._session.rollback()
            raise

    def record_failure(self, sub_id: uuid.UUID, max_failures: int) -> None:
        """Counts one failed send; at `max_failures` in a row the row is deleted."""
        try:
            row = self._session.get(PushSubscription, sub_id)
            if row is not None:
                row.failure_count += 1
                if row.failure_count >= max_failures:
                    self._session.delete(row)
            self._session.commit()
        except Exception:
            self._session.rollback()
            raise

    def delete_id(self, sub_id: uuid.UUID) -> None:
        try:
            row = self._session.get(PushSubscription, sub_id)
            if row is not None:
                self._session.delete(row)
            self._session.commit()
        except Exception:
            self._session.rollback()
            raise
