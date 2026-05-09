"""Contract tests: Pydantic accepts every valid fixture and rejects every invalid one."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from generated.pydantic import Firing

FIXTURES = Path(__file__).parent / "fixtures"

# Map each Pydantic model to its fixture directory name.
MODELS = {
    "firing": Firing,
}


def _load(type_lower: str, kind: str) -> list[tuple[str, dict]]:
    folder = FIXTURES / type_lower / kind
    return [(f.name, json.loads(f.read_text())) for f in sorted(folder.glob("*.json"))]


@pytest.mark.parametrize(
    "type_lower,filename,payload",
    [(t, fn, p) for t in MODELS for fn, p in _load(t, "valid")],
)
def test_valid_fixture_parses(type_lower: str, filename: str, payload: dict) -> None:
    model = MODELS[type_lower]
    instance = model.model_validate(payload)
    re_parsed = model.model_validate(json.loads(instance.model_dump_json()))
    assert re_parsed == instance


@pytest.mark.parametrize(
    "type_lower,filename,payload",
    [(t, fn, p) for t in MODELS for fn, p in _load(t, "invalid")],
)
def test_invalid_fixture_rejected(type_lower: str, filename: str, payload: dict) -> None:
    model = MODELS[type_lower]
    with pytest.raises(ValidationError):
        model.model_validate(payload)
