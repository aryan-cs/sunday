"""
messenger.py — Messaging output layer.

Sends formatted summaries to Telegram and/or iMessage (macOS only).
"""
from __future__ import annotations

import logging
import re
import subprocess
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx

from config import Config
from errors import MessagingDeliveryError

log = logging.getLogger(__name__)


def _trim_sentence(text: str) -> str:
    """Remove trailing sentence punctuation without changing the content."""
    return text.strip().rstrip(".!?").strip()


def _casualize_headline(text: str) -> str:
    """Convert a reminder headline into a lower-case text-message style."""
    casual = _trim_sentence(text).lower()
    casual = casual.replace("a.m.", "am").replace("p.m.", "pm")
    casual = re.sub(r"\b(\d{1,2})\s+(am|pm)\b", r"\1\2", casual)
    casual = re.sub(r"\b(\d{1,2}):00\s*(am|pm)\b", r"\1\2", casual)
    casual = re.sub(r"\b(\d{1,2}:\d{2})\s*(am|pm)\b", r"\1\2", casual)
    return casual


def _format_time_label(date_str: str | None, start_time: str | None) -> str | None:
    """Return a friendly time label like '3:00 p.m.' or 'Apr 4 at 3:00 p.m.'."""
    if not date_str or not start_time:
        return None

    try:
        event_dt = datetime.strptime(f"{date_str} {start_time}", "%Y-%m-%d %H:%M")
    except ValueError:
        return None

    today = datetime.now(ZoneInfo(Config.timezone)).date()
    time_label = event_dt.strftime("%I:%M %p").lstrip("0").lower().replace("am", "a.m.").replace(
        "pm", "p.m."
    )

    if event_dt.date() == today:
        return time_label

    return f"{event_dt.strftime('%b %d').replace(' 0', ' ')} at {time_label}"


def _format_leave_by_label(departure_time: str | None) -> str | None:
    """Return a friendly leave-by label."""
    if not departure_time:
        return None

    try:
        departure_dt = datetime.strptime(departure_time.strip(), "%I:%M %p")
    except ValueError:
        return departure_time

    return departure_dt.strftime("%I:%M %p").lstrip("0").lower().replace("am", "a.m.").replace(
        "pm", "p.m."
    )


class TelegramMessenger:
    """Send messages via a Telegram bot."""

    BASE_URL = "https://api.telegram.org"

    async def send(self, message: str) -> bool:
        """Send a plain-text message to the configured Telegram chat."""
        if not Config.telegram_token or not Config.telegram_chat_id:
            return False

        url = f"{self.BASE_URL}/bot{Config.telegram_token}/sendMessage"
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(
                    url,
                    json={
                        "chat_id": Config.telegram_chat_id,
                        "text": message,
                    },
                )
                resp.raise_for_status()
        except Exception as exc:
            raise MessagingDeliveryError("Telegram send failed.") from exc

        log.debug("Telegram message sent")
        return True


class IMessageSender:
    """Send messages via iMessage using AppleScript (macOS only)."""

    async def send(self, message: str) -> bool:
        """Send a plain-text iMessage to the configured recipient."""
        if not Config.imessage_enabled:
            return False

        if not Config.imessage_recipient:
            raise MessagingDeliveryError(
                "IMESSAGE_RECIPIENT must be configured when iMessage is enabled."
            )

        escaped = message.replace("\\", "\\\\").replace('"', '\\"')
        script = f'''\
tell application "Messages"
    set targetBuddy to "{Config.imessage_recipient}"
    set targetService to id of 1st account whose service type = iMessage
    set theMessage to "{escaped}"
    send theMessage to participant targetBuddy of account id targetService
end tell
'''
        try:
            subprocess.run(
                ["osascript", "-e", script],
                check=True,
                capture_output=True,
                timeout=15,
            )
        except FileNotFoundError as exc:
            raise MessagingDeliveryError("iMessage delivery requires macOS and osascript.") from exc
        except subprocess.CalledProcessError as exc:
            raise MessagingDeliveryError(
                f"iMessage AppleScript error: {exc.stderr.decode().strip()}"
            ) from exc
        except subprocess.TimeoutExpired as exc:
            raise MessagingDeliveryError("iMessage send timed out.") from exc

        log.debug("iMessage sent to %s", Config.imessage_recipient)
        return True


def format_summary(
    parsed_email: dict,
    calendar_status: str = "not_applicable",
    travel_info: dict | None = None,
    processing_notes: list[str] | None = None,
    source_email_link: str | None = None,
) -> str:
    """Format a parsed email dict into a human-readable message."""
    del source_email_link
    notes = processing_notes or []
    summary = _trim_sentence(parsed_email.get("summary", "new email")) or "new email"
    event = parsed_email.get("event") or {}
    lines: list[str] = []

    if parsed_email.get("has_event"):
        lines.append(f"reminder: {_casualize_headline(summary)}!")
        if event.get("location"):
            lines.append(f"location: {event['location']}")

        time_label = _format_time_label(event.get("date"), event.get("start_time"))
        if time_label:
            lines.append(f"time: {time_label}")

        if event.get("is_online") and event.get("meeting_link"):
            lines.append(f"join: {event['meeting_link']}")

        leave_by = _format_leave_by_label((travel_info or {}).get("departure_time"))
        if leave_by:
            lines.append(f"leave by: {leave_by}")

        if calendar_status == "skipped_incomplete":
            lines.append("calendar: not added yet")
    else:
        lines.append(f"update: {summary}")

        urgency = parsed_email.get("urgency", "none")
        if urgency and urgency != "none":
            lines.append(f"urgency: {urgency}")

        if parsed_email.get("needs_response"):
            lines.append("needs a reply")

        for item in parsed_email.get("action_items", []):
            lines.append(f"to do: {item}")

        if parsed_email.get("can_wait"):
            lines.append("this can wait")

    for note in notes:
        lines.append(f"note: {note}")

    return "\n".join(lines)


async def send_summary(
    parsed_email: dict,
    calendar_status: str = "not_applicable",
    travel_info: dict | None = None,
    processing_notes: list[str] | None = None,
    source_email_link: str | None = None,
) -> None:
    """
    Format and dispatch a summary to all configured messaging channels.

    Raises:
        MessagingDeliveryError: If no configured channel can deliver the summary.
    """
    message = format_summary(
        parsed_email,
        calendar_status,
        travel_info,
        processing_notes,
        source_email_link,
    )

    telegram = TelegramMessenger()
    imessage = IMessageSender()

    configured_channels = 0
    sent_any = False
    errors: list[str] = []

    async def _send_main_and_link(sender) -> bool:
        delivered = await sender.send(message)
        if delivered and source_email_link:
            try:
                await sender.send(source_email_link)
            except MessagingDeliveryError as exc:
                log.warning("Follow-up email link delivery failed: %s", exc)
        return delivered

    if Config.telegram_token and Config.telegram_chat_id:
        configured_channels += 1
        try:
            sent_any |= await _send_main_and_link(telegram)
        except MessagingDeliveryError as exc:
            errors.append(str(exc))

    if Config.imessage_enabled:
        configured_channels += 1
        try:
            sent_any |= await _send_main_and_link(imessage)
        except MessagingDeliveryError as exc:
            errors.append(str(exc))

    if configured_channels == 0:
        raise MessagingDeliveryError(
            "No messaging channel is configured. Configure Telegram or iMessage."
        )

    if not sent_any:
        raise MessagingDeliveryError("; ".join(errors) or "No messaging channel delivered the summary.")
