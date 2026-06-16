#!/usr/bin/env python3
"""One-time: mint ``authorized_user.json`` for Google Sheets export via OAuth.

Run this on a **laptop with a browser** — not the Pi. It runs the installed-app
("Desktop") consent flow against the OAuth client secret you downloaded from the
Google Cloud Console, opens a browser for you to consent as your treehouse.pro
user, and writes an ``authorized_user.json`` holding the long-lived refresh
token. Copy that file to the Pi and point ``UDCPINE_SHEETS_OAUTH_TOKEN`` at it.

Because the OAuth consent screen is **Internal** to the Workspace, the refresh
token does not hit the 7-day "Testing" expiry — it stays valid indefinitely, so
this is genuinely a one-time step.

Usage (from web/backend/):

    uv run python scripts/sheets_oauth_bootstrap.py \
        --client-secret /path/to/client_secret_XXX.json \
        --out authorized_user.json
"""

from __future__ import annotations

import argparse
from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow

# Kept in sync by hand with udcpine_backend.sheets.SCOPES. Inlined rather than
# imported so this one-off script does not require the backend package (and its
# generated.pydantic import) to be on the path — you only need
# google-auth-oauthlib, i.e. run it with `uv run` from web/backend/.
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--client-secret",
        required=True,
        help="Path to the OAuth Desktop client secret JSON from Google Cloud Console.",
    )
    parser.add_argument(
        "--out",
        default="authorized_user.json",
        help="Where to write the minted token (default: ./authorized_user.json).",
    )
    args = parser.parse_args()

    flow = InstalledAppFlow.from_client_secrets_file(args.client_secret, SCOPES)
    # Spins up a throwaway localhost server to catch the OAuth redirect, then
    # opens the consent page in your browser. port=0 picks a free port.
    creds = flow.run_local_server(port=0)

    out = Path(args.out)
    out.write_text(creds.to_json())
    out.chmod(0o600)
    print(
        f"\nWrote {out.resolve()} (chmod 600).\n"
        "Copy it to the Pi and set:\n"
        f"  UDCPINE_SHEETS_OAUTH_TOKEN={out.name}\n"
        "  UDCPINE_SHEETS_SPREADSHEET_ID=<the spreadsheet id from its URL>\n"
    )


if __name__ == "__main__":
    main()
