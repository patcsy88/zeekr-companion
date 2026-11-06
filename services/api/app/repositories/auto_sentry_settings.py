from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AutoSentrySettings

DEFAULT_QUIET_MINUTES = 60


@dataclass(frozen=True)
class SavedAutoSentry:
    enabled: bool
    quiet_minutes: int


class AutoSentrySettingsRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def get(self) -> SavedAutoSentry:
        """The saved row, or off and 60 minutes when there is none."""
        row = self._session.scalars(
            select(AutoSentrySettings).where(AutoSentrySettings.id == 1)
        ).first()
        saved = (
            SavedAutoSentry(False, DEFAULT_QUIET_MINUTES)
            if row is None
            else SavedAutoSentry(row.enabled, row.quiet_minutes)
        )
        self._session.rollback()
        return saved

    def save(self, enabled: bool, quiet_minutes: int, now: dt.datetime) -> None:
        try:
            row = self._session.get(AutoSentrySettings, 1)
            if row is None:
                self._session.add(
                    AutoSentrySettings(
                        id=1, enabled=enabled, quiet_minutes=quiet_minutes, updated_at=now
                    )
                )
            else:
                row.enabled = enabled
                row.quiet_minutes = quiet_minutes
                row.updated_at = now
            self._session.commit()
        except Exception:
            self._session.rollback()
            raise
