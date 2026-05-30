"""HTTP uploader.

The sample loop drops samples onto a ``queue.Queue``; this worker thread
drains them and POSTs to the backend. The sample loop never blocks on the
network. On failure, samples land in an in-memory ``deque(maxlen=120)``
and are drained **newest-first** on the next successful POST — older
samples are discarded so the dashboard never visually rewinds after an
outage.
"""

from __future__ import annotations

import logging
import queue
import threading
from collections import deque
from typing import Any

import requests

log = logging.getLogger(__name__)

# Sentinel pushed onto the queue to signal a clean shutdown.
_SHUTDOWN: Any = object()

HTTP_TIMEOUT_S = 2.0
HTTP_RETRIES = 1  # one retry in addition to the initial attempt
BUFFER_MAXLEN = 120


class Uploader:
    """Background HTTP uploader fed by a queue."""

    def __init__(self, server: str, *, session: requests.Session | None = None) -> None:
        self._url = f"{server.rstrip('/')}/api/ingest/sample"
        self._queue: queue.Queue[Any] = queue.Queue()
        self._buffer: deque[float] = deque(maxlen=BUFFER_MAXLEN)
        self._session = session or requests.Session()
        self._thread = threading.Thread(target=self._run, name="udcpine-uploader", daemon=True)
        self._stopped = threading.Event()

    # ---- public API ---------------------------------------------------

    def start(self) -> None:
        self._thread.start()

    def submit(self, temp_c: float) -> None:
        """Hand a sample to the uploader. Never blocks (queue is unbounded)."""
        self._queue.put(temp_c)

    def stop(self, timeout: float | None = 5.0) -> None:
        self._queue.put(_SHUTDOWN)
        self._thread.join(timeout=timeout)
        self._stopped.set()

    # ---- internal -----------------------------------------------------

    def _run(self) -> None:
        while True:
            item = self._queue.get()
            if item is _SHUTDOWN:
                return
            temp_c = float(item)
            if self._post(temp_c):
                self._drain_buffer()
            else:
                # Buffer newest sample; deque drops oldest automatically.
                self._buffer.append(temp_c)

    def _drain_buffer(self) -> None:
        """Drain the buffer newest-first; stop on first failure."""
        while self._buffer:
            # Newest first: pop from the right.
            sample = self._buffer.pop()
            if not self._post(sample):
                # Put it back at the right (still the newest unsent) and bail.
                self._buffer.append(sample)
                return

    def _post(self, temp_c: float) -> bool:
        payload = {"temp_c": temp_c}
        attempts = HTTP_RETRIES + 1
        for attempt in range(1, attempts + 1):
            try:
                resp = self._session.post(
                    self._url,
                    json=payload,
                    timeout=HTTP_TIMEOUT_S,
                    headers={"Content-Type": "application/json"},
                )
            except requests.RequestException as exc:
                log.warning(
                    "POST %s failed (attempt %d/%d): %s",
                    self._url,
                    attempt,
                    attempts,
                    exc,
                )
                continue
            if 200 <= resp.status_code < 300:
                return True
            log.warning(
                "POST %s returned HTTP %d (attempt %d/%d)",
                self._url,
                resp.status_code,
                attempt,
                attempts,
            )
        return False
