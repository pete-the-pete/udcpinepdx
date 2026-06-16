"""Tests for the Google Sheets export module.

The row *content* lives in pure functions — tested directly here, with no I/O.
The gspread orchestration (ensure tab / append / create-or-replace) is tested
against a hand-written fake gspread client, so the real code path is exercised
without a network call. ``FakeSheetsExporter`` is checked too, since the app's
stop-wiring tests lean on it.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import gspread
import pytest
from generated.pydantic import Firing, Pizza, Sample

from udcpine_backend.sheets import (
    DETAIL_HEADER,
    FIRINGS_HEADER,
    PIZZAS_HEADER,
    FakeSheetsExporter,
    GspreadSheetsExporter,
    NoopSheetsExporter,
    build_exporter_from_env,
    c_to_f,
    detail_rows,
    detail_tab_title,
    firing_summary_row,
    pizza_rows,
)

T0 = datetime(2026, 6, 14, 18, 0, 0, tzinfo=timezone.utc)


def make_firing(*, id: int = 1, end_min: float | None = 90, status: str = "ended") -> Firing:
    end = None if end_min is None else T0 + timedelta(minutes=end_min)
    return Firing(id=id, started_at=T0, ended_at=end, status=status)


def make_sample(secs: float, temp_c: float) -> Sample:
    return Sample(t=T0 + timedelta(seconds=secs), temp_c=temp_c)


def make_pizza(
    *, id: int, seq: int, name: str, end_secs: float | None, firing_id: int = 1
) -> Pizza:
    return Pizza(
        id=id,
        firing_id=firing_id,
        seq=seq,
        name=name,
        started_at=T0,
        ended_at=None if end_secs is None else T0 + timedelta(seconds=end_secs),
    )


# ---- pure row builders ----------------------------------------------------


def test_c_to_f() -> None:
    assert c_to_f(0.0) == 32.0
    assert c_to_f(100.0) == 212.0


def test_firing_summary_row_with_samples() -> None:
    firing = make_firing(id=7, end_min=90)
    samples = [make_sample(0, 100.0), make_sample(10, 200.0), make_sample(20, 150.0)]
    pizzas = [
        make_pizza(id=1, seq=1, name="Margherita", end_secs=120),
        make_pizza(id=2, seq=2, name="Diavola", end_secs=None),
    ]

    row = firing_summary_row(firing, samples, pizzas)

    assert row[0] == 7  # firing_id
    assert row[1] == T0.isoformat()  # started_at
    assert row[2] == (T0 + timedelta(minutes=90)).isoformat()  # ended_at
    assert row[3] == 90.0  # duration_min
    assert row[4] == 3  # sample_count
    assert row[5] == 200.0  # max_temp_c
    assert row[6] == 392.0  # max_temp_f
    assert row[7] == 150.0  # avg_temp_c
    assert row[8] == (T0 + timedelta(seconds=10)).isoformat()  # peak_temp_at
    assert row[9] == 2  # pizza_count
    assert row[10] == "Margherita, Diavola"  # pizza_names


def test_firing_summary_row_without_samples_blanks_temp_and_duration() -> None:
    firing = make_firing(id=3, end_min=None, status="active")
    row = firing_summary_row(firing, [], [])

    assert row[2] == ""  # ended_at (still active)
    assert row[3] == ""  # duration_min
    assert row[4] == 0  # sample_count
    assert row[5] == "" and row[6] == "" and row[7] == "" and row[8] == ""
    assert row[9] == 0
    assert row[10] == ""


def test_pizza_rows_cook_duration_and_open_pizza() -> None:
    pizzas = [
        make_pizza(id=1, seq=1, name="Margherita", end_secs=150),
        make_pizza(id=2, seq=2, name="Diavola", end_secs=None),
    ]
    rows = pizza_rows(pizzas)

    assert rows[0] == [
        1,
        1,
        "Margherita",
        T0.isoformat(),
        (T0 + timedelta(seconds=150)).isoformat(),
        2.5,
    ]
    # An open pizza has no end and a blank cook duration.
    assert rows[1] == [1, 2, "Diavola", T0.isoformat(), "", ""]


def test_detail_rows_include_fahrenheit() -> None:
    rows = detail_rows([make_sample(0, 100.0), make_sample(1, 232.0)])
    assert rows == [
        [T0.isoformat(), 100.0, 212.0],
        [(T0 + timedelta(seconds=1)).isoformat(), 232.0, 449.6],
    ]


def test_detail_tab_title() -> None:
    assert detail_tab_title(42) == "firing-42"


# ---- FakeSheetsExporter ---------------------------------------------------


def test_fake_exporter_records_all_three_tabs() -> None:
    exporter = FakeSheetsExporter()
    firing = make_firing(id=5)
    samples = [make_sample(0, 100.0)]
    pizzas = [make_pizza(id=1, seq=1, name="Margherita", end_secs=120)]

    exporter.export_firing(firing, samples, pizzas)

    assert exporter.exported_firing_ids == [5]
    assert exporter.firings_rows == [firing_summary_row(firing, samples, pizzas)]
    assert exporter.pizzas_rows == pizza_rows(pizzas)
    assert exporter.detail_tabs["firing-5"] == [DETAIL_HEADER, *detail_rows(samples)]


# ---- GspreadSheetsExporter orchestration (fake gspread client) ------------


class FakeWorksheet:
    def __init__(self, title: str) -> None:
        self.title = title
        self.rows: list[list] = []

    def append_row(self, values, value_input_option=None) -> None:
        self.rows.append(list(values))

    def append_rows(self, values, value_input_option=None) -> None:
        self.rows.extend([list(r) for r in values])


class FakeSpreadsheet:
    def __init__(self) -> None:
        self.by_title: dict[str, FakeWorksheet] = {}
        self.deleted: list[str] = []

    def worksheet(self, title: str) -> FakeWorksheet:
        try:
            return self.by_title[title]
        except KeyError:
            raise gspread.WorksheetNotFound(title) from None

    def add_worksheet(self, title: str, rows: int, cols: int) -> FakeWorksheet:
        ws = FakeWorksheet(title)
        self.by_title[title] = ws
        return ws

    def del_worksheet(self, ws: FakeWorksheet) -> None:
        self.deleted.append(ws.title)
        self.by_title.pop(ws.title, None)


class FakeClient:
    def __init__(self, spreadsheet: FakeSpreadsheet) -> None:
        self._sh = spreadsheet
        self.opened: list[str] = []

    def open_by_key(self, key: str) -> FakeSpreadsheet:
        self.opened.append(key)
        return self._sh


def test_gspread_exporter_writes_three_tabs() -> None:
    sh = FakeSpreadsheet()
    client = FakeClient(sh)
    exporter = GspreadSheetsExporter(client, "SHEET_ID")

    firing = make_firing(id=1)
    samples = [make_sample(0, 100.0), make_sample(10, 200.0)]
    pizzas = [make_pizza(id=1, seq=1, name="Margherita", end_secs=120)]

    exporter.export_firing(firing, samples, pizzas)

    assert client.opened == ["SHEET_ID"]

    firings = sh.by_title["Firings"]
    assert firings.rows[0] == FIRINGS_HEADER
    assert firings.rows[1] == firing_summary_row(firing, samples, pizzas)

    pizzas_ws = sh.by_title["Pizzas"]
    assert pizzas_ws.rows[0] == PIZZAS_HEADER
    assert pizzas_ws.rows[1:] == pizza_rows(pizzas)

    detail = sh.by_title["firing-1"]
    assert detail.rows == [DETAIL_HEADER, *detail_rows(samples)]


def test_gspread_exporter_skips_pizzas_tab_when_no_pizzas() -> None:
    sh = FakeSpreadsheet()
    exporter = GspreadSheetsExporter(FakeClient(sh), "X")
    exporter.export_firing(make_firing(id=1), [make_sample(0, 100.0)], [])
    assert "Pizzas" not in sh.by_title


def test_gspread_exporter_replaces_existing_detail_tab() -> None:
    sh = FakeSpreadsheet()
    stale = sh.add_worksheet("firing-1", rows=1, cols=3)
    stale.append_row(["stale", "data"])

    exporter = GspreadSheetsExporter(FakeClient(sh), "X")
    samples = [make_sample(0, 123.0)]
    exporter.export_firing(make_firing(id=1), samples, [])

    assert "firing-1" in sh.deleted
    assert sh.by_title["firing-1"].rows == [DETAIL_HEADER, *detail_rows(samples)]


def test_gspread_exporter_reuses_firings_tab_across_exports() -> None:
    sh = FakeSpreadsheet()
    exporter = GspreadSheetsExporter(FakeClient(sh), "X")

    exporter.export_firing(make_firing(id=1), [make_sample(0, 100.0)], [])
    exporter.export_firing(make_firing(id=2), [make_sample(0, 200.0)], [])

    firings = sh.by_title["Firings"]
    # Header written exactly once; one summary row appended per firing.
    assert firings.rows[0] == FIRINGS_HEADER
    assert len(firings.rows) == 3


# ---- factory --------------------------------------------------------------


def test_build_exporter_is_noop_when_unconfigured(monkeypatch) -> None:
    monkeypatch.delenv("UDCPINE_SHEETS_OAUTH_TOKEN", raising=False)
    monkeypatch.delenv("UDCPINE_SHEETS_SPREADSHEET_ID", raising=False)
    assert isinstance(build_exporter_from_env(), NoopSheetsExporter)


@pytest.mark.parametrize(
    "present",
    ["UDCPINE_SHEETS_OAUTH_TOKEN", "UDCPINE_SHEETS_SPREADSHEET_ID"],
)
def test_build_exporter_is_noop_when_only_one_var_set(monkeypatch, present) -> None:
    monkeypatch.delenv("UDCPINE_SHEETS_OAUTH_TOKEN", raising=False)
    monkeypatch.delenv("UDCPINE_SHEETS_SPREADSHEET_ID", raising=False)
    monkeypatch.setenv(present, "something")
    assert isinstance(build_exporter_from_env(), NoopSheetsExporter)
