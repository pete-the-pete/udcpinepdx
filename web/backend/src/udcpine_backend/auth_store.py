"""In-memory authentication state: bootstrap secret, one-shot pairing
tokens, and the set of paired devices.

Only SHA-256 hashes of tokens and cookies are kept — raw values exist
only in transit and on the client. A dump of this object cannot be
replayed to forge a session.

Lifecycle matches the firing Store: in-memory, lost on restart. After a
restart you re-pair by opening the freshly printed bootstrap link.
"""

from __future__ import annotations

import hashlib
import secrets
import threading
import time


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


_PAIRING_TOKEN_TTL_S = 300  # 5 minutes — scan the QR promptly


class AuthStore:
    def __init__(self, bootstrap_token: str) -> None:
        self._lock = threading.Lock()
        self._bootstrap_hash = _hash(bootstrap_token)
        # token_hash -> expires_at (epoch seconds). Presence == unused.
        self._pairing_tokens: dict[str, float] = {}
        # cookie_hash -> created_at (epoch seconds).
        self._devices: dict[str, float] = {}

    def mint_pairing_token(self) -> str:
        """Create a one-shot pairing token, valid for 5 minutes."""
        token = secrets.token_urlsafe(32)
        with self._lock:
            self._pairing_tokens[_hash(token)] = time.time() + _PAIRING_TOKEN_TTL_S
        return token

    def exchange(self, token: str) -> str | None:
        """Trade a token for a fresh session cookie value, or None if the
        token is not valid. The bootstrap token is reusable; a minted
        pairing token is consumed on first successful exchange."""
        token_hash = _hash(token)
        with self._lock:
            if token_hash == self._bootstrap_hash:
                pass  # reusable — not consumed
            elif token_hash in self._pairing_tokens:
                expires_at = self._pairing_tokens.pop(token_hash)  # consume
                if time.time() > expires_at:
                    return None  # expired (and now removed)
            else:
                return None
            cookie = secrets.token_urlsafe(32)
            self._devices[_hash(cookie)] = time.time()
            return cookie

    def validate_cookie(self, cookie: str) -> bool:
        with self._lock:
            return _hash(cookie) in self._devices

    def device_count(self) -> int:
        with self._lock:
            return len(self._devices)
