"""Tests for the uploader worker thread.

We use ``responses`` to mock HTTP. The uploader is a threaded background
worker, so tests poll for the queue to drain rather than relying on
arbitrary sleeps.
"""

from __future__ import annotations

import time

import pytest
import responses

from udcpine_firmware.uploader import BUFFER_MAXLEN, Uploader

URL = "http://backend.test:5001/api/ingest/sample"
SERVER = "http://backend.test:5001"


def _wait_until(predicate, timeout: float = 2.0, interval: float = 0.01) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(interval)
    return predicate()


@responses.activate
def test_uploader_posts_sample_as_json() -> None:
    responses.add(responses.POST, URL, status=204)
    up = Uploader(SERVER)
    up.start()
    try:
        up.submit(250.5)
        assert _wait_until(lambda: len(responses.calls) == 1)
    finally:
        up.stop()

    call = responses.calls[0]
    assert call.request.headers["Content-Type"] == "application/json"
    assert call.request.body == b'{"temp_c": 250.5}'


def test_uploader_buffers_on_failure_and_drains_newest_first() -> None:
    """Network goes down, three samples buffer, then network comes back and
    the buffer drains newest-first.

    We use a callback so we can flip from "always fail" to "always succeed"
    mid-test, rather than fighting `responses`' registration-order semantics.
    """
    import json
    import threading

    fail = threading.Event()
    fail.set()
    bodies: list[bytes] = []
    success_bodies: list[bytes] = []

    def handler(request):
        bodies.append(request.body)
        if fail.is_set():
            return (500, {}, "boom")
        success_bodies.append(request.body)
        return (204, {}, "")

    with responses.RequestsMock() as rsps:
        rsps.add_callback(responses.POST, URL, callback=handler)

        up = Uploader(SERVER)
        up.start()
        try:
            # Three failed posts → all land in the buffer.
            up.submit(100.0)
            up.submit(200.0)
            up.submit(300.0)

            # Wait until all three have been attempted (each attempts twice:
            # initial + 1 retry) and ended up in the buffer.
            assert _wait_until(lambda: up._queue.empty() and len(up._buffer) == 3, timeout=3.0)

            # Flip the network back on, then submit one more.
            fail.clear()
            up.submit(400.0)

            # Wait for queue + buffer to fully drain.
            assert _wait_until(lambda: up._queue.empty() and not up._buffer, timeout=3.0)
        finally:
            up.stop()

    # Successful bodies, in order:
    #   400.0   (the one that broke the failure streak)
    #   300.0   (newest buffered → popped first)
    #   200.0
    #   100.0   (oldest → popped last)
    assert [json.loads(b)["temp_c"] for b in success_bodies] == [400.0, 300.0, 200.0, 100.0]


@responses.activate
def test_uploader_buffer_caps_at_maxlen() -> None:
    # All POSTs fail forever.
    responses.add(responses.POST, URL, status=500)

    up = Uploader(SERVER)
    up.start()
    try:
        # Submit more than BUFFER_MAXLEN samples; once the worker has drained
        # the queue into the buffer, the deque should be capped.
        n = BUFFER_MAXLEN + 50
        for i in range(n):
            up.submit(float(i))
        assert _wait_until(lambda: up._queue.empty(), timeout=5.0)
        # Buffer should never exceed maxlen.
        assert len(up._buffer) == BUFFER_MAXLEN
        # And it should contain the newest values, not the oldest.
        # (Newest submitted = n - 1; oldest retained = n - BUFFER_MAXLEN.)
        assert up._buffer[-1] == pytest.approx(float(n - 1))
        assert up._buffer[0] == pytest.approx(float(n - BUFFER_MAXLEN))
    finally:
        up.stop()


@responses.activate
def test_uploader_retries_once_on_request_exception() -> None:
    # First attempt: connection error. Second attempt (the one retry): 204.
    responses.add(responses.POST, URL, body=__import__("requests").ConnectionError("nope"))
    responses.add(responses.POST, URL, status=204)

    up = Uploader(SERVER)
    up.start()
    try:
        up.submit(123.0)
        assert _wait_until(lambda: len(responses.calls) == 2)
    finally:
        up.stop()
