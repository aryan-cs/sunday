"""
gmail_watcher.py — Gmail polling and authentication.

Polls Gmail for newly arrived inbox messages. Messages that were already
present before the watcher started are ignored; only emails received after
startup are eligible for processing.
"""
from __future__ import annotations

import base64
import json
import logging
import time
from html.parser import HTMLParser
from typing import Any

from .config import Config
from .state_store import get_state_dir, get_state_file

log = logging.getLogger(__name__)

_PROCESSED_FILE = get_state_file("processed_messages.json")
_WATCHER_STATE_FILE = get_state_file("gmail_watcher_state.json")


class _HTMLTextExtractor(HTMLParser):
    """Small HTML-to-text helper for email bodies."""

    def __init__(self) -> None:
        super().__init__()
        self._parts: list[str] = []

    def handle_data(self, data: str) -> None:
        stripped = data.strip()
        if stripped:
            self._parts.append(stripped)

    def get_text(self) -> str:
        return "\n".join(self._parts)


def _load_processed_ids() -> set[str]:
    """Load the set of successfully processed Gmail message IDs."""
    if not _PROCESSED_FILE.exists():
        return set()

    try:
        data = json.loads(_PROCESSED_FILE.read_text())
    except (OSError, ValueError) as exc:
        log.warning("Could not read processed email state: %s", exc)
        return set()

    if not isinstance(data, list):
        log.warning("Processed email state is invalid; resetting it.")
        return set()

    return {item for item in data if isinstance(item, str)}


def _save_processed_ids(processed_ids: set[str]) -> None:
    """Persist successfully processed Gmail message IDs."""
    get_state_dir(create=True)
    _PROCESSED_FILE.write_text(json.dumps(sorted(processed_ids), indent=2))


def _load_startup_cutoff_ms() -> tuple[int, str]:
    """Return the watcher cutoff timestamp and a short description of its source."""
    now_ms = int(time.time() * 1000)

    if _WATCHER_STATE_FILE.exists():
        try:
            data = json.loads(_WATCHER_STATE_FILE.read_text())
        except (OSError, ValueError) as exc:
            log.warning("Could not read Gmail watcher state: %s", exc)
        else:
            last_poll_ms = data.get("last_poll_ms")
            if isinstance(last_poll_ms, int) and last_poll_ms > 0:
                return last_poll_ms, "saved_state"

    if _PROCESSED_FILE.exists():
        try:
            processed_mtime_ms = int(_PROCESSED_FILE.stat().st_mtime * 1000)
        except OSError as exc:
            log.warning("Could not inspect processed email state: %s", exc)
        else:
            return processed_mtime_ms, "processed_state_mtime"

    return now_ms, "fresh_start"


def _save_watcher_cutoff_ms(cutoff_ms: int) -> None:
    """Persist the watcher cutoff timestamp so restarts can resume cleanly."""
    get_state_dir(create=True)
    _WATCHER_STATE_FILE.write_text(json.dumps({"last_poll_ms": cutoff_ms}, indent=2))


class GmailWatcher:
    """
    Poll Gmail for messages that arrived after startup.

    The watcher uses Gmail's `internalDate` so a message still counts as new
    even if you open it before the next polling cycle.
    """

    def __init__(self) -> None:
        from .google_auth import get_google_service

        self.service = get_google_service("gmail", "v1")
        self._account_email = self._load_account_email()
        self._seen_ids: set[str] = set()
        self._processed_ids: set[str] = _load_processed_ids()
        self._startup_cutoff_ms, cutoff_source = _load_startup_cutoff_ms()
        log.info(
            "Watcher baseline set at %d (%s). Only emails newer than that point will be processed.",
            self._startup_cutoff_ms,
            cutoff_source,
        )

    def _load_account_email(self) -> str:
        """Return the signed-in Gmail address when it can be fetched."""
        try:
            profile = self.service.users().getProfile(userId="me").execute()
        except Exception as exc:
            log.warning("Could not load Gmail profile email: %s", exc)
            return ""

        return str(profile.get("emailAddress", "")).strip().lower()

    def _list_message_ids_page(self, page_token: str | None = None, max_results: int = 25) -> dict:
        """Return one page of inbox message IDs."""
        return (
            self.service.users()
            .messages()
            .list(
                userId="me",
                labelIds=Config.gmail_labels,
                maxResults=max_results,
                pageToken=page_token,
            )
            .execute()
        )

    def get_new_emails(self, max_results: int = 10) -> list[dict]:
        """
        Fetch inbox emails that arrived after startup and were not processed yet.

        Raises:
            RuntimeError: If Gmail cannot be queried.
        """
        page_token: str | None = None
        new_emails: list[dict] = []

        poll_started_ms = int(time.time() * 1000)

        try:
            while len(new_emails) < max_results:
                results = self._list_message_ids_page(page_token=page_token, max_results=25)
                messages = results.get("messages", [])
                if not messages:
                    break

                stop_paging = False
                for msg_meta in messages:
                    msg_id = msg_meta["id"]
                    if msg_id in self._seen_ids or msg_id in self._processed_ids:
                        continue

                    msg = (
                        self.service.users()
                        .messages()
                        .get(userId="me", id=msg_id, format="full")
                        .execute()
                    )

                    internal_date_ms = int(msg.get("internalDate", "0"))
                    if internal_date_ms <= self._startup_cutoff_ms:
                        stop_paging = True
                        continue

                    self._seen_ids.add(msg_id)
                    new_emails.append(self._parse_message(msg))
                    if len(new_emails) >= max_results:
                        break

                if stop_paging or len(new_emails) >= max_results:
                    break

                page_token = results.get("nextPageToken")
                if not page_token:
                    break
        except Exception as exc:
            raise RuntimeError("Gmail list failed.") from exc
        finally:
            self._startup_cutoff_ms = max(self._startup_cutoff_ms, poll_started_ms)
            _save_watcher_cutoff_ms(self._startup_cutoff_ms)

        return new_emails

    def mark_as_processed(self, message_id: str) -> None:
        """Persist a message as processed and remove the UNREAD label if present."""
        try:
            self.service.users().messages().modify(
                userId="me",
                id=message_id,
                body={"removeLabelIds": ["UNREAD"]},
            ).execute()
        except Exception as exc:
            raise RuntimeError(f"Could not mark message {message_id} as processed.") from exc

        self._processed_ids.add(message_id)
        _save_processed_ids(self._processed_ids)

    def _parse_message(self, msg: dict[str, Any]) -> dict:
        """
        Extract useful fields from a raw Gmail API message dict.

        Returns a flat dict with: id, from, to, subject, date, body, snippet.
        """
        headers = {header["name"]: header["value"] for header in msg["payload"]["headers"]}
        body = self._extract_body(msg["payload"])

        return {
            "id": msg["id"],
            "thread_id": msg.get("threadId", ""),
            "from": headers.get("From", ""),
            "to": headers.get("To", ""),
            "cc": headers.get("Cc", ""),
            "subject": headers.get("Subject", ""),
            "date": headers.get("Date", ""),
            "body": body[:5000],
            "snippet": msg.get("snippet", ""),
            "account_email": getattr(self, "_account_email", ""),
        }

    @staticmethod
    def _decode_body(data: str) -> str:
        return base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")

    @classmethod
    def _extract_body(cls, payload: dict) -> str:
        """
        Recursively extract the plaintext body from a MIME payload.

        Prefers text/plain and converts HTML to plain text when needed.
        """
        if "parts" not in payload:
            data = payload.get("body", {}).get("data", "")
            return cls._decode_body(data) if data else ""

        plain = ""
        html = ""
        for part in payload["parts"]:
            mime = part.get("mimeType", "")
            data = part.get("body", {}).get("data", "")
            if not data:
                if "parts" in part:
                    nested = cls._extract_body(part)
                    if nested:
                        return nested
                continue

            decoded = cls._decode_body(data)
            if mime == "text/plain" and not plain:
                plain = decoded
            elif mime == "text/html" and not html:
                html = decoded

        if plain:
            return plain
        if html:
            parser = _HTMLTextExtractor()
            parser.feed(html)
            return parser.get_text()
        return ""
