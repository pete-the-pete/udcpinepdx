"""AuthStore: in-memory pairing tokens + paired devices."""

from __future__ import annotations

from udcpine_backend.auth_store import AuthStore


def test_bootstrap_token_exchanges_to_a_cookie() -> None:
    a = AuthStore(bootstrap_token="boot-secret")
    cookie = a.exchange("boot-secret")
    assert cookie is not None
    assert a.validate_cookie(cookie) is True


def test_bootstrap_token_is_reusable() -> None:
    a = AuthStore(bootstrap_token="boot-secret")
    c1 = a.exchange("boot-secret")
    c2 = a.exchange("boot-secret")
    # Two distinct devices, both valid — the bootstrap token is not consumed.
    assert c1 != c2
    assert a.validate_cookie(c1) is True
    assert a.validate_cookie(c2) is True


def test_wrong_token_does_not_exchange() -> None:
    a = AuthStore(bootstrap_token="boot-secret")
    assert a.exchange("not-the-secret") is None


def test_minted_pairing_token_exchanges_once() -> None:
    a = AuthStore(bootstrap_token="boot-secret")
    token = a.mint_pairing_token()
    cookie = a.exchange(token)
    assert cookie is not None
    # One-shot: the same token cannot be exchanged again.
    assert a.exchange(token) is None


def test_unknown_cookie_is_invalid() -> None:
    a = AuthStore(bootstrap_token="boot-secret")
    assert a.validate_cookie("never-issued") is False


def test_device_count_reflects_exchanges() -> None:
    a = AuthStore(bootstrap_token="boot-secret")
    assert a.device_count() == 0
    a.exchange("boot-secret")
    a.exchange("boot-secret")
    assert a.device_count() == 2


def test_raw_token_is_not_stored() -> None:
    # Only hashes live in the store — assert the raw secret appears nowhere
    # in the token/device tables.
    a = AuthStore(bootstrap_token="boot-secret")
    token = a.mint_pairing_token()
    a.exchange(token)
    blob = repr(a.__dict__)
    assert token not in blob
    assert "boot-secret" not in blob.replace("bootstrap_token", "")
