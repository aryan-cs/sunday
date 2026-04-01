"""
google_auth.py — Shared Google OAuth helper.

Handles two modes:
  1. Local / file-based:  token.json lives on disk (normal dev workflow)
  2. Vercel / env-based:  token JSON is stored as GOOGLE_TOKEN_JSON env var
                          (base64-encoded so it survives env var restrictions)

To prepare for Vercel:
    1. Run locally first so token.json is created.
    2. Base64-encode it:
           python -c "import base64; print(base64.b64encode(open('token.json','rb').read()).decode())"
    3. Paste the output as GOOGLE_TOKEN_JSON in your Vercel project's
       Environment Variables (Settings → Environment Variables).
    4. Similarly encode credentials.json → GOOGLE_CREDENTIALS_JSON.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import tempfile
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

from config import Config

log = logging.getLogger(__name__)

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar",
]


def _load_credentials_file() -> Path:
    """
    Return a path to credentials.json.

    If GOOGLE_CREDENTIALS_JSON env var is set (base64-encoded contents),
    write it to a temp file and return that path. Otherwise use Config path.
    """
    env_creds = os.environ.get("GOOGLE_CREDENTIALS_JSON")
    if env_creds:
        log.debug("Loading credentials from GOOGLE_CREDENTIALS_JSON env var")
        decoded = base64.b64decode(env_creds)
        tmp = tempfile.NamedTemporaryFile(
            suffix=".json", delete=False, mode="wb"
        )
        tmp.write(decoded)
        tmp.flush()
        return Path(tmp.name)

    return Path(Config.google_creds_file)


def _load_token() -> Credentials | None:
    """
    Load a saved OAuth token.

    Checks (in order):
      1. GOOGLE_TOKEN_JSON env var (base64-encoded, used on Vercel)
      2. token.json file on disk (used locally)
    """
    env_token = os.environ.get("GOOGLE_TOKEN_JSON")
    if env_token:
        log.debug("Loading token from GOOGLE_TOKEN_JSON env var")
        token_data = json.loads(base64.b64decode(env_token))
        return Credentials.from_authorized_user_info(token_data, SCOPES)

    token_path = Path(Config.google_token_file)
    if token_path.exists():
        return Credentials.from_authorized_user_file(str(token_path), SCOPES)

    return None


def _save_token(creds: Credentials) -> None:
    """
    Persist the token to disk.

    On Vercel the filesystem is ephemeral (read-only in prod), so we just
    log a reminder to update the env var. Locally it writes to token.json.
    """
    try:
        token_path = Path(Config.google_token_file)
        token_path.write_text(creds.to_json())
        log.info("Token saved to %s", token_path)
        log.info(
            "To deploy to Vercel, update GOOGLE_TOKEN_JSON with:\n"
            "  python -c \"import base64; print(base64.b64encode("
            "open('token.json','rb').read()).decode())\""
        )
    except OSError as exc:
        log.warning("Could not save token to disk: %s", exc)


def get_google_service(service_name: str, version: str):
    """
    Authenticate with Google and return an API service client.

    Works both locally (file-based token) and on Vercel (env-var token).

    Args:
        service_name: e.g. "gmail" or "calendar"
        version:      e.g. "v1" or "v3"
    """
    creds = _load_token()

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            log.info("Refreshing Google OAuth token…")
            creds.refresh(Request())
            _save_token(creds)
        else:
            # Interactive OAuth flow — only works locally
            if os.environ.get("VERCEL"):
                raise RuntimeError(
                    "Google OAuth token is missing or invalid. "
                    "Run the app locally first to generate token.json, "
                    "then set GOOGLE_TOKEN_JSON in your Vercel environment variables."
                )
            log.info("Starting Google OAuth flow — a browser window will open.")
            creds_path = _load_credentials_file()
            flow = InstalledAppFlow.from_client_secrets_file(str(creds_path), SCOPES)
            creds = flow.run_local_server(port=0)
            _save_token(creds)

    return build(service_name, version, credentials=creds)
