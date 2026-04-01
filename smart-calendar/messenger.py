"""
messenger.py — Messaging output layer.

Sends formatted summaries to Telegram and/or iMessage (macOS only).
"""
from __future__ import annotations

import logging
import subprocess

import httpx

from config import Config
from errors import MessagingDeliveryError

log = logging.getLogger(__name__)


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
) -> str:
    """Format a parsed email dict into a human-readable message."""
    notes = processing_notes or []
    lines: list[str] = ["New Email"]

    if parsed_email.get("summary"):
        lines.append(f"Summary: {parsed_email['summary']}")

    urgency = parsed_email.get("urgency", "none")
    if urgency and urgency != "none":
        lines.append(f"Urgency: {urgency.title()}")

    if parsed_email.get("needs_response"):
        lines.append("Needs your response.")

    if parsed_email.get("action_items"):
        lines.append("Action items:")
        for item in parsed_email["action_items"]:
            lines.append(f"- {item}")

    if calendar_status == "created":
        event = parsed_email.get("event") or {}
        lines.append(f'Calendar event created: "{event.get("title", "Event")}"')
    elif calendar_status == "existing":
        lines.append("Calendar already has this event.")
    elif calendar_status == "skipped_incomplete":
        lines.append("Calendar event was not created because required scheduling details were missing.")

    if travel_info and travel_info.get("travel_minutes"):
        departure = travel_info.get("departure_time")
        if departure:
            lines.append(
                f"Leave by {departure} "
                f"({travel_info['travel_minutes']} min travel + {Config.prep_time} min prep)"
            )
        else:
            lines.append(f"Travel time: {travel_info['travel_minutes']} min")

    if parsed_email.get("can_wait"):
        lines.append("This can wait.")

    if notes:
        lines.append("Processing notes:")
        for note in notes:
            lines.append(f"- {note}")

    return "\n".join(lines)


async def send_summary(
    parsed_email: dict,
    calendar_status: str = "not_applicable",
    travel_info: dict | None = None,
    processing_notes: list[str] | None = None,
) -> None:
    """
    Format and dispatch a summary to all configured messaging channels.

    Raises:
        MessagingDeliveryError: If no configured channel can deliver the summary.
    """
    message = format_summary(parsed_email, calendar_status, travel_info, processing_notes)

    telegram = TelegramMessenger()
    imessage = IMessageSender()

    configured_channels = 0
    sent_any = False
    errors: list[str] = []

    if Config.telegram_token and Config.telegram_chat_id:
        configured_channels += 1
        try:
            sent_any |= await telegram.send(message)
        except MessagingDeliveryError as exc:
            errors.append(str(exc))

    if Config.imessage_enabled:
        configured_channels += 1
        try:
            sent_any |= await imessage.send(message)
        except MessagingDeliveryError as exc:
            errors.append(str(exc))

    if configured_channels == 0:
        raise MessagingDeliveryError(
            "No messaging channel is configured. Configure Telegram or iMessage."
        )

    if not sent_any:
        raise MessagingDeliveryError("; ".join(errors) or "No messaging channel delivered the summary.")
