"""Smoke tests: create_app() picks up UDCPINE_BOOTSTRAP_TOKEN from env."""

from __future__ import annotations

import pytest

from udcpine_backend.app import create_app
from udcpine_backend.auth_store import AuthStore


def test_create_app_uses_env_bootstrap_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When UDCPINE_BOOTSTRAP_TOKEN is set, create_app passes it to AuthStore.

    The token must be exchangeable (i.e. it reached AuthStore.bootstrap_token),
    not a fresh random value generated inside create_app.
    """
    monkeypatch.setenv("UDCPINE_BOOTSTRAP_TOKEN", "stable-kiosk-token")
    app = create_app()
    auth: AuthStore = app.config["AUTH"]
    cookie = auth.exchange("stable-kiosk-token")
    assert (
        cookie is not None
    ), "create_app() did not use UDCPINE_BOOTSTRAP_TOKEN from the environment"
    assert auth.validate_cookie(cookie) is True


def test_create_app_random_token_when_env_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When UDCPINE_BOOTSTRAP_TOKEN is absent, create_app uses a random token.

    The random token is not guessable, so exchanging with an arbitrary string
    must fail — proving a stable token was NOT used.
    """
    monkeypatch.delenv("UDCPINE_BOOTSTRAP_TOKEN", raising=False)
    app = create_app()
    auth: AuthStore = app.config["AUTH"]
    cookie = auth.exchange("stable-kiosk-token")
    assert cookie is None, "create_app() produced a predictable token when env var was absent"


def test_create_app_env_token_is_reusable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The env-sourced bootstrap token is reusable (kiosk can re-pair on restart)."""
    monkeypatch.setenv("UDCPINE_BOOTSTRAP_TOKEN", "kiosk-stable")
    app = create_app()
    auth: AuthStore = app.config["AUTH"]
    c1 = auth.exchange("kiosk-stable")
    c2 = auth.exchange("kiosk-stable")
    assert c1 is not None
    assert c2 is not None
    assert c1 != c2, "Each exchange should mint a distinct cookie"
    assert auth.validate_cookie(c1) is True
    assert auth.validate_cookie(c2) is True
