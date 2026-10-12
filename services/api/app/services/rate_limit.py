"""In-memory sliding-window limiter for failed login attempts (per process)."""

from __future__ import annotations

import math
import threading
import time
from collections import deque
from collections.abc import Callable

_MAX_TRACKED_KEYS = 10_000


class FailureLimiter:
    def __init__(
        self,
        max_failures: int,
        window_seconds: int,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._max = max_failures
        self._window = window_seconds
        self._clock = clock
        self._failures: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def _prune(self, key: str, now: float) -> deque[float]:
        events = self._failures.setdefault(key, deque())
        while events and now - events[0] >= self._window:
            events.popleft()
        if not events:
            self._failures.pop(key, None)
        return events

    def retry_after(self, key: str) -> int | None:
        """Seconds until another attempt is allowed, or None if not blocked."""
        with self._lock:
            now = self._clock()
            events = self._prune(key, now)
            if len(events) < self._max:
                return None
            return max(1, math.ceil(self._window - (now - events[0])))

    def record_failure(self, key: str) -> int:
        """Record a failure and return the number of failures in the current window."""
        with self._lock:
            now = self._clock()
            if len(self._failures) >= _MAX_TRACKED_KEYS:
                for stale in list(self._failures):
                    self._prune(stale, now)
            events = self._failures.setdefault(key, deque())
            events.append(now)
            return len(events)

    def reset(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)
