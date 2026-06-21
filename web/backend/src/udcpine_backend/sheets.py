"""Export a finished firing to a Google Sheet.

This is the repo's first outbound third-party integration. It is deliberately
isolated so the rest of the backend never imports gspread or touches the
network: the row *content* lives in pure functions (testable with no I/O), and
the gspread calls live behind a small ``SheetsExporter`` protocol with three
implementations —

  * ``GspreadSheetsExporter`` — the real one (talks to Google),
  * ``FakeSheetsExporter``    — records what it would write, for tests,
  * ``NoopSheetsExporter``    — does nothing, wired when unconfigured.

``build_exporter_from_env()`` returns the no-op unless both
``UDCPINE_SHEETS_OAUTH_TOKEN`` and ``UDCPINE_SHEETS_SPREADSHEET_ID`` are set, so
dev, CI, and a Pi without credentials all keep working unchanged.

Auth is OAuth (installed-app / "Desktop" flow), not a service-account key — the
treehouse.pro org policy ``iam.disableServiceAccountKeyCreation`` blocks key
downloads. The one-time ``authorized_user.json`` is minted by
``scripts/sheets_oauth_bootstrap.py``; here we just load + auto-refresh it.

Temperatures are Celsius in storage (the dashboard renders °F). The sheet
carries °C as canonical with °F alongside the headline numbers.
"""

from __future__ import annotations

import logging
import os
from typing import Protocol

from generated.pydantic import Firing, Pizza, Sample

log = logging.getLogger(__name__)

# Read+write a spreadsheet we open by key. We never list/search Drive, so the
# narrower spreadsheets scope is enough — and the bootstrap token must be minted
# with this same scope.
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

FIRINGS_TAB = "Firings"
PIZZAS_TAB = "Pizzas"

FIRINGS_HEADER = [
    "firing_id",
    "started_at",
    "ended_at",
    "duration_min",
    "sample_count",
    "max_temp_c",
    "max_temp_f",
    "avg_temp_c",
    "peak_temp_at",
    "pizza_count",
    "pizza_names",
]
PIZZAS_HEADER = ["firing_id", "seq", "name", "started_at", "ended_at", "cook_duration_min"]
DETAIL_HEADER = ["t", "temp_c", "temp_f"]


# ---- pure row builders (no I/O — unit-tested directly) --------------------


def c_to_f(temp_c: float) -> float:
    return temp_c * 9.0 / 5.0 + 32.0


def _round1(x: float) -> float:
    return round(x, 1)


def _minutes_between(start, end) -> float | str:
    """Whole-ish minutes between two aware datetimes, or "" if end is None."""
    if end is None:
        return ""
    return _round1((end - start).total_seconds() / 60.0)


def detail_tab_title(firing_id: int) -> str:
    return f"firing-{firing_id}"


def firing_summary_row(firing: Firing, samples: list[Sample], pizzas: list[Pizza]) -> list:
    """One ``Firings`` row. Temp stats are blank when a firing has no samples."""
    if samples:
        temps = [s.temp_c for s in samples]
        peak = max(samples, key=lambda s: s.temp_c)
        max_temp_c: float | str = _round1(peak.temp_c)
        max_temp_f: float | str = _round1(c_to_f(peak.temp_c))
        avg_temp_c: float | str = _round1(sum(temps) / len(temps))
        peak_temp_at: str = peak.t.isoformat()
    else:
        max_temp_c = max_temp_f = avg_temp_c = peak_temp_at = ""

    return [
        firing.id,
        firing.started_at.isoformat(),
        "" if firing.ended_at is None else firing.ended_at.isoformat(),
        _minutes_between(firing.started_at, firing.ended_at),
        len(samples),
        max_temp_c,
        max_temp_f,
        avg_temp_c,
        peak_temp_at,
        len(pizzas),
        ", ".join(p.name for p in pizzas),
    ]


def pizza_rows(pizzas: list[Pizza]) -> list[list]:
    """One ``Pizzas`` row per pizza, in seq order."""
    return [
        [
            p.firing_id,
            p.seq,
            p.name,
            p.started_at.isoformat(),
            "" if p.ended_at is None else p.ended_at.isoformat(),
            _minutes_between(p.started_at, p.ended_at),
        ]
        for p in pizzas
    ]


def detail_rows(samples: list[Sample]) -> list[list]:
    """The full ``firing-<id>`` temp series, oldest first."""
    return [[s.t.isoformat(), _round1(s.temp_c), _round1(c_to_f(s.temp_c))] for s in samples]


# ---- exporter protocol + implementations ----------------------------------


class SheetsExporter(Protocol):
    def export_firing(self, firing: Firing, samples: list[Sample], pizzas: list[Pizza]) -> None: ...


class NoopSheetsExporter:
    """Wired when Sheets export is unconfigured. Silently does nothing."""

    def export_firing(self, firing: Firing, samples: list[Sample], pizzas: list[Pizza]) -> None:
        return None


class GspreadSheetsExporter:
    """Writes a firing's summary row, pizza rows, and full temp-series tab to a
    spreadsheet opened by key. Raises on any gspread/network error — the caller
    (``app.py``) runs this off the request thread and swallows failures so a
    failed export never breaks ``POST /api/firing/stop``.
    """

    def __init__(self, client, spreadsheet_id: str) -> None:
        self._client = client
        self._spreadsheet_id = spreadsheet_id

    def export_firing(self, firing: Firing, samples: list[Sample], pizzas: list[Pizza]) -> None:
        sh = self._client.open_by_key(self._spreadsheet_id)

        firings_ws = self._ensure_ws(sh, FIRINGS_TAB, FIRINGS_HEADER)
        firings_ws.append_row(
            firing_summary_row(firing, samples, pizzas),
            value_input_option="USER_ENTERED",
        )

        prows = pizza_rows(pizzas)
        if prows:
            pizzas_ws = self._ensure_ws(sh, PIZZAS_TAB, PIZZAS_HEADER)
            pizzas_ws.append_rows(prows, value_input_option="USER_ENTERED")

        # Detail tab is create-or-replace, keyed by firing id, so a re-export is
        # idempotent (the summary rows above are append-only by design).
        title = detail_tab_title(firing.id)
        self._replace_ws(sh, title, [DETAIL_HEADER, *detail_rows(samples)])

    @staticmethod
    def _ensure_ws(sh, title: str, header: list[str]):
        """Return the worksheet named ``title``, creating it with a header row
        the first time."""
        import gspread

        try:
            return sh.worksheet(title)
        except gspread.WorksheetNotFound:
            ws = sh.add_worksheet(title=title, rows=1, cols=len(header))
            ws.append_row(header, value_input_option="USER_ENTERED")
            return ws

    @staticmethod
    def _replace_ws(sh, title: str, rows: list[list]) -> None:
        """Drop any existing worksheet named ``title`` and recreate it with
        ``rows`` written in a single batched call (one Sheets write)."""
        import gspread

        try:
            sh.del_worksheet(sh.worksheet(title))
        except gspread.WorksheetNotFound:
            pass
        ws = sh.add_worksheet(title=title, rows=max(len(rows), 1), cols=len(rows[0]))
        ws.append_rows(rows, value_input_option="USER_ENTERED")


class FakeSheetsExporter:
    """Records what a real export would write, for tests. Reuses the same pure
    row builders as the real exporter, so asserting on these fields verifies the
    actual layout — not a parallel re-implementation."""

    def __init__(self) -> None:
        self.exported_firing_ids: list[int] = []
        self.firings_rows: list[list] = []
        self.pizzas_rows: list[list] = []
        self.detail_tabs: dict[str, list[list]] = {}

    def export_firing(self, firing: Firing, samples: list[Sample], pizzas: list[Pizza]) -> None:
        self.exported_firing_ids.append(firing.id)
        self.firings_rows.append(firing_summary_row(firing, samples, pizzas))
        self.pizzas_rows.extend(pizza_rows(pizzas))
        self.detail_tabs[detail_tab_title(firing.id)] = [DETAIL_HEADER, *detail_rows(samples)]


class RaisingSheetsExporter:
    """Always fails — used to prove a broken export never breaks the stop."""

    def __init__(self) -> None:
        self.attempts: list[int] = []

    def export_firing(self, firing: Firing, samples: list[Sample], pizzas: list[Pizza]) -> None:
        self.attempts.append(firing.id)
        raise RuntimeError("simulated Sheets failure")


def build_exporter_from_env() -> SheetsExporter:
    """Real exporter when both env vars are set, else a no-op.

    Loading the credentials and authorizing the gspread client are deferred to
    here (not import time) so the module stays importable — and the test path
    stays network-free — without the OAuth token present.
    """
    token = os.environ.get("UDCPINE_SHEETS_OAUTH_TOKEN")
    spreadsheet_id = os.environ.get("UDCPINE_SHEETS_SPREADSHEET_ID")
    if not token or not spreadsheet_id:
        return NoopSheetsExporter()

    import gspread
    from google.oauth2.credentials import Credentials

    creds = Credentials.from_authorized_user_file(token, SCOPES)
    client = gspread.authorize(creds)
    log.info("Google Sheets export enabled (spreadsheet %s)", spreadsheet_id)
    return GspreadSheetsExporter(client, spreadsheet_id)
