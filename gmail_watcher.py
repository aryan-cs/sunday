"""
gmail_watcher.py — Gmail polling and authentication.

Polls for unread emails on a configurable interval. Uses OAuth2 via
the Google API Python client library. On first run it opens a browser
for the consent screen; subsequent runs refresh the saved token.
"""
from __future__ import annotations

import base64
import json
import logging
from html.parser import HTMLParser
from typing import Any

from config import Config
from state_store import get_state_dir, get_state_file

log = logging.getLogger(__name__)

_PROCESSED_FILE = get_state_file("processed_messages.json")


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


class GmailWatcher:
    """
    Polls Gmail for unread messages on the configured labels.

    Any messages that are already unread when the watcher starts are
    treated as backlog and ignored. Only emails that arrive after the
    process starts are eligible for processing.
    """

    def __init__(self) -> None:
        from google_auth import get_google_service

        self.service = get_google_service("gmail", "v1")
        self._seen_ids: set[str] = set()
        self._processed_ids: set[str] = _load_processed_ids()
        self._startup_unread_ids = self._list_unread_message_ids()
        if self._startup_unread_ids:
            log.info(
                "Ignoring %d unread email(s) that were already in the inbox at startup.",
                len(self._startup_unread_ids),
            )

    def _list_unread_message_ids(self, max_results: int | None = None) -> list[str]:
        """Return unread Gmail message IDs, newest first."""
        page_token: str | None = None
        unread_ids: list[str] = []

        while True:
            request = (
                self.service.users()
                .messages()
                .list(
                    userId="me",
                    labelIds=Config.gmail_labels,
                    q="is:unread",
                    maxResults=max_results or 100,
                    pageToken=page_token,
                )
            )
            results = request.execute()
            unread_ids.extend(
                message["id"]
                for message in results.get("messages", [])
                if "id" in message
            )

            if max_results is not None and len(unread_ids) >= max_results:
                return unread_ids[:max_results]

            page_token = results.get("nextPageToken")
            if not page_token:
                return unread_ids

    def get_new_emails(self, max_results: int = 10) -> list[dict]:
        """
        Fetch unread, unseen emails from the configured Gmail labels.

        Raises:
            RuntimeError: If Gmail cannot be queried.
        """
        try:
            message_ids = self._list_unread_message_ids(max_results=max_results)
        except Exception as exc:
            raise RuntimeError("Gmail list failed.") from exc

        new_emails: list[dict] = []

        for msg_id in message_ids:
            if (
                msg_id in self._startup_unread_ids
                or msg_id in self._seen_ids
                or msg_id in self._processed_ids
            ):
                continue

            self._seen_ids.add(msg_id)
            msg = (
                self.service.users()
                .messages()
                .get(userId="me", id=msg_id, format="full")
                .execute()
            )
            new_emails.append(self._parse_message(msg))

        return new_emails

    def mark_as_processed(self, message_id: str) -> None:
        """Persist a message as processed and remove the UNREAD label."""
        try:
            self.service.users().messages().modify(
                userId="me",
                id=message_id,
                body={"removeLabelIds": ["UNREAD"]},
            ).execute()
        except Exception as exc:
            raise RuntimeError(f"Could not mark message {message_id} as read.") from exc

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
            "from": headers.get("From", ""),
            "to": headers.get("To", ""),
            "subject": headers.get("Subject", ""),
            "date": headers.get("Date", ""),
            "body": body[:5000],
            "snippet": msg.get("snippet", ""),
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
