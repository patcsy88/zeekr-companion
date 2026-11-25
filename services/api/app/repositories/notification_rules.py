from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import NotificationRule


class NotificationRuleRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def all(self) -> list[NotificationRule]:
        rows = list(
            self._session.scalars(
                select(NotificationRule).order_by(NotificationRule.created_at, NotificationRule.id)
            ).all()
        )
        self._session.rollback()
        return rows

    def get(self, rule_id: uuid.UUID) -> NotificationRule | None:
        row = self._session.get(NotificationRule, rule_id)
        self._session.rollback()
        return row

    def create(
        self, values: dict[str, Any], now: dt.datetime, limit: int
    ) -> NotificationRule | None:
        """The new rule, or None when `limit` rules already exist."""
        try:
            held = self._session.scalar(select(func.count()).select_from(NotificationRule)) or 0
            if held >= limit:
                self._session.rollback()
                return None
            row = NotificationRule(
                id=uuid.uuid4(), created_at=now, updated_at=now, last_matched=None, **values
            )
            self._session.add(row)
            self._session.commit()
            return row
        except Exception:
            self._session.rollback()
            raise

    def replace(
        self, rule_id: uuid.UUID, values: dict[str, Any], now: dt.datetime
    ) -> NotificationRule | None:
        """Saves the new values. A change to `match` or `conditions` clears the last result, so
        the edited rule can send once (ADR-015). `last_sent_at` is kept."""
        try:
            row = self._session.get(NotificationRule, rule_id)
            if row is None:
                self._session.rollback()
                return None
            if row.match != values["match"] or row.conditions != values["conditions"]:
                row.last_matched = None
                row.last_result = None
            for key, value in values.items():
                setattr(row, key, value)
            row.updated_at = now
            self._session.commit()
            return row
        except Exception:
            self._session.rollback()
            raise

    def set_state(
        self,
        rule_id: uuid.UUID,
        *,
        last_matched: bool | None,
        last_result: str | None,
        last_sent_at: dt.datetime | None,
    ) -> None:
        """Saves what a check found. A rule deleted in the meantime is skipped."""
        try:
            row = self._session.get(NotificationRule, rule_id)
            if row is not None:
                row.last_matched = last_matched
                row.last_result = last_result
                row.last_sent_at = last_sent_at
                self._session.commit()
            else:
                self._session.rollback()
        except Exception:
            self._session.rollback()
            raise

    def delete(self, rule_id: uuid.UUID) -> bool:
        try:
            row = self._session.get(NotificationRule, rule_id)
            if row is None:
                self._session.rollback()
                return False
            self._session.delete(row)
            self._session.commit()
            return True
        except Exception:
            self._session.rollback()
            raise
