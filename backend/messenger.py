"""
messenger.py — Messaging output layer.

Sends formatted summaries to Telegram and/or iMessage (macOS only).
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import subprocess
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

from .config import Config
from .errors import MessagingDeliveryError
from .state_store import get_state_file

log = logging.getLogger(__name__)
_DISPLAY_LOCATION_PROPERTY = "smartCalendarDisplayLocation"


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


def _natural_join(values: list[str]) -> str:
    """Join compact values like participant names for a headline."""
    if not values:
        return ""
    if len(values) == 1:
        return values[0]
    if len(values) == 2:
        return f"{values[0]} and {values[1]}"
    return f"{', '.join(values[:-1])}, and {values[-1]}"


def _normalise_match(text: str) -> str:
    """Normalise text for fuzzy containment checks."""
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def _compact_people_phrase(people_text: str) -> str:
    """Turn 'Aryan Gupta and Jane Doe' into 'Aryan and Jane' for texts."""
    pieces = [part.strip() for part in re.split(r"\s*,\s*|\s+and\s+", people_text) if part.strip()]
    compact: list[str] = []
    for piece in pieces:
        first_token = piece.split()[0]
        if first_token:
            compact.append(first_token)
    return _natural_join(compact)


def _compact_title_for_headline(title: str) -> str:
    """Convert a calendar-style title into a shorter text-style phrase."""
    cleaned = _trim_sentence(title)
    match = re.search(r"^(.*?)(?:\s+with\s+)(.+)$", cleaned, re.IGNORECASE)
    if not match:
        return cleaned

    base, people = match.groups()
    compact_people = _compact_people_phrase(people)
    if not compact_people:
        return cleaned
    return f"{base} w/ {compact_people}"


def _strip_meeting_word(text: str) -> str:
    """Remove filler words like 'meeting' from alert headlines."""
    return re.sub(r"\bmeeting\b", "", text, flags=re.IGNORECASE).strip()


def _location_name_for_headline(location: str | None) -> str | None:
    """Return the place name portion of a resolved location string."""
    if not location:
        return None
    return location.split(" (", 1)[0].strip() or None


def _event_location_label(event: dict) -> str | None:
    """Prefer the friendly display location when present."""
    return event.get("display_location") or event.get("location")


def _calendar_event_location_label(event: dict) -> str | None:
    """Prefer stored display location from Calendar extended properties."""
    private_props = ((event.get("extendedProperties") or {}).get("private") or {})
    return private_props.get(_DISPLAY_LOCATION_PROPERTY) or event.get("location")


def _headline_day_suffix(date_str: str | None) -> str | None:
    """Return 'today' or 'tomorrow' when appropriate."""
    if not date_str:
        return None

    try:
        event_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        return None

    today = datetime.now(ZoneInfo(Config.timezone)).date()
    if event_date == today:
        return "today"
    if event_date == today + timedelta(days=1):
        return "tomorrow"
    return None


def _build_event_headline(parsed_email: dict) -> str:
    """Build a casual reminder headline from the event title and metadata."""
    event = parsed_email.get("event") or {}
    title_source = event.get("title") or parsed_email.get("summary") or "event"
    headline = _compact_title_for_headline(title_source)

    location_name = _location_name_for_headline(_event_location_label(event))
    if location_name and _normalise_match(location_name) not in _normalise_match(headline):
        headline = f"{headline} at {location_name}"

    day_suffix = _headline_day_suffix(event.get("date"))
    if day_suffix and day_suffix not in headline.lower():
        headline = f"{headline} {day_suffix}"

    return _casualize_headline(headline)


def _build_leave_alert_headline(calendar_event: dict) -> str:
    """Build a compact leave-now headline from a calendar event."""
    title_source = _trim_sentence(calendar_event.get("summary", "event")) or "event"
    location_name = _location_name_for_headline(_calendar_event_location_label(calendar_event))

    match = re.search(r"^(.*?)(?:\s+with\s+)(.+)$", title_source, re.IGNORECASE)
    if match:
        base, people = match.groups()
        base = _strip_meeting_word(base) or "event"
        compact_people = _compact_people_phrase(people)
        headline = base
        if location_name and _normalise_match(location_name) not in _normalise_match(headline):
            headline = f"{headline} at {location_name}"
        if compact_people:
            headline = f"{headline} w/ {compact_people}"
        return _casualize_headline(headline)

    headline = _strip_meeting_word(title_source) or title_source
    if location_name and _normalise_match(location_name) not in _normalise_match(headline):
        headline = f"{headline} at {location_name}"
    return _casualize_headline(headline)


def _format_time_label(date_str: str | None, start_time: str | None) -> str | None:
    """Return a friendly time label like '3:00pm' or 'Apr 4 at 3:00pm'."""
    if not date_str or not start_time:
        return None

    try:
        event_dt = datetime.strptime(f"{date_str} {start_time}", "%Y-%m-%d %H:%M")
    except ValueError:
        return None

    today = datetime.now(ZoneInfo(Config.timezone)).date()
    time_label = event_dt.strftime("%I:%M %p").lstrip("0").lower().replace(" am", "am").replace(
        " pm", "pm"
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

    return departure_dt.strftime("%I:%M %p").lstrip("0").lower().replace(" am", "am").replace(
        " pm", "pm"
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


async def send_imessage_to(recipient: str, message: str) -> None:
    """
    Send an iMessage to an arbitrary recipient (phone number or iCloud email).

    Unlike IMessageSender, this does not require IMESSAGE_ENABLED — it is
    always available on macOS regardless of the configured default recipient.
    """
    escaped_msg = message.replace("\\", "\\\\").replace('"', '\\"')
    escaped_recipient = recipient.replace("\\", "\\\\").replace('"', '\\"')
    script = f'''\
tell application "Messages"
    set targetBuddy to "{escaped_recipient}"
    set targetService to id of 1st account whose service type = iMessage
    set theMessage to "{escaped_msg}"
    send theMessage to participant targetBuddy of account id targetService
end tell
'''
    try:
        await asyncio.to_thread(
            subprocess.run,
            ["osascript", "-e", script],
            check=True,
            capture_output=True,
            timeout=15,
        )
        log.info("iMessage sent to %s", recipient)
    except FileNotFoundError as exc:
        raise MessagingDeliveryError("iMessage requires macOS and osascript.") from exc
    except subprocess.CalledProcessError as exc:
        raise MessagingDeliveryError(
            f"iMessage AppleScript error: {exc.stderr.decode().strip()}"
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise MessagingDeliveryError("iMessage send timed out.") from exc


def format_summary(
    parsed_email: dict,
    calendar_status: str = "not_applicable",
    travel_info: dict | None = None,
    processing_notes: list[str] | None = None,
    source_email_link: str | None = None,
    prep_brief: str | None = None,
) -> str:
    """Format a parsed email dict into a human-readable message."""
    del source_email_link
    notes = processing_notes or []
    summary = _trim_sentence(parsed_email.get("summary", "new email")) or "new email"
    event = parsed_email.get("event") or {}
    lines: list[str] = []

    if parsed_email.get("has_event"):
        lines.append(f"⏰ {_build_event_headline(parsed_email)}!")
        lines.append("")
        event_location = _event_location_label(event)
        if event_location:
            lines.append(f"📍 {event_location}")

        time_label = _format_time_label(event.get("date"), event.get("start_time"))
        if time_label:
            lines.append(f"🕐 {time_label}")

        if event.get("is_online") and event.get("meeting_link"):
            lines.append(f"🔗 {event['meeting_link']}")

        leave_by = _format_leave_by_label((travel_info or {}).get("departure_time"))
        if leave_by:
            lines.append(f"🚗 leave by {leave_by}")

        if calendar_status == "skipped_incomplete":
            lines.append("📅 not added yet")
    else:
        lines.append(f"📬 {summary}")

        has_detail = (
            (parsed_email.get("urgency", "none") not in ("", "none"))
            or parsed_email.get("needs_response")
            or parsed_email.get("action_items")
            or parsed_email.get("can_wait")
        )
        if has_detail:
            lines.append("")

        urgency = parsed_email.get("urgency", "none")
        if urgency and urgency != "none":
            lines.append(f"⚠️ {urgency}")

        if parsed_email.get("needs_response"):
            lines.append("💬 needs a reply")

        for item in parsed_email.get("action_items", []):
            lines.append(f"✅ {item}")

        if parsed_email.get("can_wait"):
            lines.append("😌 this can wait")

    if prep_brief:
        lines.append("")
        lines.append("🧠 heads up:")
        lines.append(prep_brief)

    if notes:
        lines.append("")
        for note in notes:
            lines.append(f"ℹ️ {note}")

    return "\n".join(lines)


def format_leave_alert(calendar_event: dict) -> str:
    """Format a leave-now text message for a due in-person event."""
    lines = [f"‼️ hey, it's time to leave for {_build_leave_alert_headline(calendar_event)}!"]
    location = _calendar_event_location_label(calendar_event)
    if location:
        lines.append(f"📍 {location}")
    return "\n".join(lines)


class ExpoPushSender:
    """Send push notifications to registered Expo app devices."""

    EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

    def _load_tokens(self) -> list[str]:
        path = get_state_file("push_tokens.json")
        if not path.exists():
            return []
        try:
            tokens = json.loads(path.read_text())
            return [t for t in tokens if isinstance(t, str) and t.startswith("ExponentPushToken")]
        except (OSError, json.JSONDecodeError):
            return []

    def _prune_token(self, token: str) -> None:
        """Remove a token that Expo reports as invalid."""
        path = get_state_file("push_tokens.json")
        try:
            tokens = json.loads(path.read_text())
            tokens = [t for t in tokens if t != token]
            path.write_text(json.dumps(tokens))
        except (OSError, json.JSONDecodeError):
            pass

    async def send(self, message: str) -> bool:
        if not Config.expo_push_enabled:
            return False

        tokens = self._load_tokens()
        if not tokens:
            log.debug("Expo push enabled but no tokens registered")
            return False

        messages = [{"to": token, "title": "Sunday", "body": message} for token in tokens]

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(self.EXPO_PUSH_URL, json=messages)
                resp.raise_for_status()
                data = resp.json()
        except Exception as exc:
            raise MessagingDeliveryError("Expo push send failed.") from exc

        sent_any = False
        for token, result in zip(tokens, data.get("data", [])):
            status = result.get("status")
            if status == "ok":
                sent_any = True
            elif result.get("details", {}).get("error") == "DeviceNotRegistered":
                log.warning("Pruning unregistered Expo token")
                self._prune_token(token)

        log.debug("Expo push sent to %d device(s)", len(tokens))
        return sent_any


async def send_text_message(message: str, follow_up_link: str | None = None) -> None:
    """Send a plain outbound text through all configured messaging channels."""
    telegram = TelegramMessenger()
    imessage = IMessageSender()
    expo = ExpoPushSender()

    configured_channels = 0
    sent_any = False
    errors: list[str] = []

    async def _send_main_and_link(sender) -> bool:
        delivered = await sender.send(message)
        if delivered and follow_up_link and Config.text_email_links:
            try:
                await sender.send(follow_up_link)
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

    if Config.expo_push_enabled:
        configured_channels += 1
        try:
            sent_any |= await expo.send(message)
        except MessagingDeliveryError as exc:
            errors.append(str(exc))

    if configured_channels == 0:
        raise MessagingDeliveryError(
            "No messaging channel is configured. Configure Telegram or iMessage."
        )

    if not sent_any:
        raise MessagingDeliveryError("; ".join(errors) or "No messaging channel delivered the message.")


async def send_summary(
    parsed_email: dict,
    calendar_status: str = "not_applicable",
    travel_info: dict | None = None,
    processing_notes: list[str] | None = None,
    source_email_link: str | None = None,
    prep_brief: str | None = None,
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
        prep_brief,
    )
    await send_text_message(message, source_email_link)
