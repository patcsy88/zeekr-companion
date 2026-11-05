"""The last Sentry state this API saw after a send, pushed to open pages (ADR-010).

In memory only: nothing is stored, a restart forgets it, and nothing here reads the car. A send
runs on a worker thread and the streams run on the event loop, so a publish hands over with
`call_soon_threadsafe`.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import threading

MAX_STREAMS = 4


class Subscription:
    def __init__(self, loop: asyncio.AbstractEventLoop) -> None:
        self.loop = loop
        self.queue: asyncio.Queue[tuple[str, dt.datetime]] = asyncio.Queue(maxsize=4)

    def put(self, item: tuple[str, dt.datetime]) -> None:
        # Runs on the loop. A page that is slow to read only needs the newest state.
        if self.queue.full():
            self.queue.get_nowait()
        self.queue.put_nowait(item)


class SentryStateHub:
    def __init__(self, max_streams: int = MAX_STREAMS) -> None:
        self._lock = threading.Lock()
        self._max = max_streams
        self._state: tuple[str, dt.datetime] | None = None
        self._subs: list[Subscription] = []

    def current(self) -> tuple[str, dt.datetime] | None:
        with self._lock:
            return self._state

    def publish(self, state: str, at: dt.datetime) -> None:
        with self._lock:
            self._state = (state, at)
            subs = list(self._subs)
        for sub in subs:
            try:
                sub.loop.call_soon_threadsafe(sub.put, (state, at))
            except RuntimeError:  # that page's loop is closed; it is dropped on unsubscribe
                continue

    def subscribe(self, loop: asyncio.AbstractEventLoop) -> Subscription | None:
        with self._lock:
            if len(self._subs) >= self._max:
                return None
            sub = Subscription(loop)
            self._subs.append(sub)
            return sub

    def unsubscribe(self, sub: Subscription) -> None:
        with self._lock:
            if sub in self._subs:
                self._subs.remove(sub)

    def stream_count(self) -> int:
        with self._lock:
            return len(self._subs)
