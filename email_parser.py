"""
email_parser.py — LLM-powered email parsing.

Sends each email through the active LLM and gets back a structured
JSON dict describing whether the email contains an event, what the
event details are, action items, urgency, etc.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from email.utils import parseaddr
from zoneinfo import ZoneInfo
from urllib.parse import urlparse

from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

from config import Config
from errors import EmailParseError
from llm_client import parse_with_json

log = logging.getLogger(__name__)


class ParsedEvent(BaseModel):
    """Structured event information extracted from an email."""

    title: str | None = None
    date: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    location: str | None = None
    is_online: bool | None = None
    meeting_link: str | None = None
    description: str | None = None
    attendees: list[str] = Field(default_factory=list)
    organizer: str | None = None

    @field_validator("title", "date", "start_time", "end_time", "location", "meeting_link", "description", "organizer", mode="before")
    @classmethod
    def _empty_strings_to_none(cls, value: object) -> object:
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        return value

    @field_validator("date")
    @classmethod
    def _validate_date(cls, value: str | None) -> str | None:
        if value is None:
            return value
        datetime.strptime(value, "%Y-%m-%d")
        return value

    @field_validator("start_time", "end_time")
    @classmethod
    def _validate_time(cls, value: str | None) -> str | None:
        if value is None:
            return value
        datetime.strptime(value, "%H:%M")
        return value

    @field_validator("meeting_link")
    @classmethod
    def _validate_link(cls, value: str | None) -> str | None:
        if value is None:
            return value
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("meeting_link must be an absolute http(s) URL")
        return value

    @field_validator("attendees", mode="before")
    @classmethod
    def _normalise_attendees(cls, value: object) -> object:
        if value is None:
            return []
        return value

    @field_validator("attendees")
    @classmethod
    def _strip_attendees(cls, value: list[str]) -> list[str]:
        return [attendee.strip() for attendee in value if attendee and attendee.strip()]


class ParsedEmail(BaseModel):
    """Structured LLM output for an email."""

    has_event: bool
    needs_response: bool
    urgency: str
    summary: str
    event: ParsedEvent | None = None
    action_items: list[str] = Field(default_factory=list)
    can_wait: bool

    @field_validator("summary", mode="before")
    @classmethod
    def _strip_summary(cls, value: object) -> object:
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                raise ValueError("summary cannot be empty")
            return stripped
        return value

    @field_validator("urgency")
    @classmethod
    def _validate_urgency(cls, value: str) -> str:
        if value not in {"high", "medium", "low", "none"}:
            raise ValueError("urgency must be one of: high, medium, low, none")
        return value

    @field_validator("action_items", mode="before")
    @classmethod
    def _normalise_actions(cls, value: object) -> object:
        if value is None:
            return []
        return value

    @field_validator("action_items")
    @classmethod
    def _strip_actions(cls, value: list[str]) -> list[str]:
        return [item.strip() for item in value if item and item.strip()]

    @model_validator(mode="after")
    def _validate_event_presence(self) -> "ParsedEmail":
        if self.has_event and self.event is None:
            raise ValueError("event must be present when has_event=true")
        if not self.has_event and self.event is not None:
            raise ValueError("event must be null when has_event=false")
        if self.has_event and self.event and self.event.is_online is None:
            raise ValueError("event.is_online must be true or false when has_event=true")
        return self


EMAIL_PARSER_SYSTEM_PROMPT = """\
You are an email parsing assistant. You analyze emails and extract structured information.

You MUST respond with ONLY valid JSON — no markdown, no explanation, no backticks.

For every email, determine:
1. Whether it contains an actionable event (meeting, appointment, deadline, etc.)
2. Whether it needs a response from the user
3. A brief human-readable summary

Return this exact JSON structure:

{
  "has_event": true/false,
  "needs_response": true/false,
  "urgency": "high" | "medium" | "low" | "none",
  "summary": "One-line human summary of the email",
  "event": {
    "title": "Meeting/event title or null if unknown",
    "date": "YYYY-MM-DD or null if unknown",
    "start_time": "HH:MM (24h format) or null if unknown",
    "end_time": "HH:MM (24h format) or null if unknown",
    "location": "Physical address OR null if online/unknown",
    "is_online": true/false,
    "meeting_link": "URL to Zoom/Meet/Teams or null",
    "description": "Brief description of what the event is about",
    "attendees": ["email1@example.com", "email2@example.com"],
    "organizer": "Name of who sent/organized this"
  },
  "action_items": ["List of things the user might need to do"],
  "can_wait": true/false
}

Rules:
- If has_event is false, set event to null.
- If you are unsure about any field, use null rather than guessing.
- If an event is clearly present but no explicit title is written, infer a short natural title.
- Do not invent or estimate an end time, location, meeting link, or attendees.
- Parse dates relative to today's date which will be provided in the user prompt.
- For Zoom/Meet/Teams links, extract the full URL from the email body.
- For online meetings with no physical location, set location to null and is_online to true.
- If an address is partial (e.g. "Siebel 2124"), expand it to a full address if you know it;
  otherwise keep it as-is.
"""


CALENDAR_REQUIRED_EVENT_FIELDS = {
    "title": "missing title",
    "date": "missing date",
    "start_time": "missing start time",
    "end_time": "missing end time",
    "is_online": "missing online/in-person flag",
}

EVENT_DURATION_HINTS: tuple[tuple[tuple[str, ...], int], ...] = (
    (("coffee", "coffee chat"), 30),
    (("phone screen", "screening call"), 30),
    (("standup", "check-in", "check in", "sync"), 30),
    (("office hours",), 30),
    (("lunch", "breakfast"), 60),
    (("meeting", "meet", "interview", "call", "appointment"), 60),
    (("brunch", "dinner"), 90),
)


def _today_local_date() -> str:
    """Return today's date in the configured timezone."""
    return datetime.now(ZoneInfo(Config.timezone)).date().isoformat()


def _event_context_text(parsed: dict, email_data: dict) -> str:
    """Return a single lowercase text blob for deterministic event inference."""
    event = parsed.get("event") or {}
    parts = [
        parsed.get("summary", ""),
        " ".join(parsed.get("action_items", [])),
        event.get("description", ""),
        email_data.get("subject", ""),
        email_data.get("body", ""),
    ]
    return " ".join(part for part in parts if part).lower()


def _sender_name(from_header: str) -> str | None:
    """Extract the display name from a From header."""
    name, address = parseaddr(from_header)
    cleaned_name = name.strip().strip('"')
    if cleaned_name:
        return cleaned_name

    local_part = address.split("@", 1)[0].replace(".", " ").replace("_", " ").strip()
    if local_part:
        return " ".join(piece.capitalize() for piece in local_part.split())

    return None


def _infer_event_title(parsed: dict, email_data: dict) -> str | None:
    """Infer a concise event title from the parsed summary, body, and sender."""
    context = _event_context_text(parsed, email_data)
    sender = _sender_name(email_data.get("from", ""))

    titled_patterns: tuple[tuple[tuple[str, ...], str], ...] = (
        (("lunch",), "Lunch"),
        (("breakfast",), "Breakfast"),
        (("brunch",), "Brunch"),
        (("dinner",), "Dinner"),
        (("coffee", "coffee chat"), "Coffee"),
        (("interview",), "Interview"),
        (("office hours",), "Office Hours"),
        (("phone screen", "screening call"), "Phone Screen"),
        (("meeting", "meet", "sync", "call"), "Meeting"),
    )

    for keywords, title_base in titled_patterns:
        if any(keyword in context for keyword in keywords):
            if sender and title_base in {"Lunch", "Breakfast", "Brunch", "Dinner", "Coffee"}:
                return f"{title_base} with {sender}"
            if sender and title_base in {"Interview", "Meeting", "Phone Screen"}:
                return f"{title_base} with {sender}"
            return title_base

    for candidate in (parsed.get("summary", ""), *(parsed.get("action_items") or [])):
        cleaned = candidate.strip().rstrip(".!?")
        if cleaned:
            return cleaned[:80]

    return None


def _infer_end_time(date_str: str | None, start_time: str | None, context: str) -> str | None:
    """Infer an end time by applying a category-based default duration."""
    if not date_str or not start_time:
        return None

    duration_minutes = 60
    for keywords, hinted_duration in EVENT_DURATION_HINTS:
        if any(keyword in context for keyword in keywords):
            duration_minutes = hinted_duration
            break

    try:
        start_dt = datetime.strptime(f"{date_str} {start_time}", "%Y-%m-%d %H:%M")
    except ValueError:
        return None

    end_dt = start_dt + timedelta(minutes=duration_minutes)
    return end_dt.strftime("%H:%M")


def enrich_event_details(parsed: dict, email_data: dict) -> dict:
    """
    Fill in missing event details that can be inferred safely from context.

    This is intentionally separate from raw LLM parsing so we can keep model
    extraction strict while still producing production-useful calendar events.
    """
    if not parsed.get("has_event") or not parsed.get("event"):
        return parsed

    event = dict(parsed["event"])
    enriched = dict(parsed)
    enriched["event"] = event
    context = _event_context_text(parsed, email_data)

    if not event.get("title"):
        inferred_title = _infer_event_title(parsed, email_data)
        if inferred_title:
            event["title"] = inferred_title

    if not event.get("end_time"):
        inferred_end_time = _infer_end_time(event.get("date"), event.get("start_time"), context)
        if inferred_end_time:
            event["end_time"] = inferred_end_time

    return enriched


async def parse_email(email_data: dict) -> dict:
    """
    Send an email through the LLM and return trusted structured data.

    Raises:
        EmailParseError: If the model response is missing required structure
        or contains invalid field values.
    """
    user_prompt = (
        f"Today's date: {_today_local_date()}\n\n"
        f"Analyze this email:\n\n"
        f"From: {email_data.get('from', '')}\n"
        f"Subject: {email_data.get('subject', '')}\n"
        f"Date: {email_data.get('date', '')}\n\n"
        f"Body:\n{email_data.get('body', '')[:3000]}"
    )

    try:
        parsed = await parse_with_json(
            prompt=user_prompt,
            system=EMAIL_PARSER_SYSTEM_PROMPT,
            temperature=0.1,
        )
        validated = ParsedEmail.model_validate(parsed)
    except (ValidationError, ValueError, TypeError) as exc:
        raise EmailParseError(
            f"Email parser returned invalid structured data for email {email_data.get('id')}."
        ) from exc
    except Exception as exc:
        raise EmailParseError(
            f"Email parsing failed for email {email_data.get('id')}."
        ) from exc

    return validated.model_dump()


def get_calendar_readiness_issues(parsed: dict) -> list[str]:
    """Return a list of reasons an event should not be written to Calendar yet."""
    if not parsed.get("has_event"):
        return []

    event = parsed.get("event") or {}
    issues = [
        message
        for key, message in CALENDAR_REQUIRED_EVENT_FIELDS.items()
        if event.get(key) is None
    ]

    if event.get("is_online") is False and not event.get("location"):
        issues.append("missing location for an in-person event")

    return issues


def summarise_parsed(parsed: dict) -> str:
    """Return a one-line human-readable summary of a parsed email dict."""
    parts = [f"[{parsed.get('urgency', '?').upper()}]"]
    parts.append(parsed.get("summary", "—"))
    if parsed.get("has_event"):
        ev = parsed.get("event") or {}
        parts.append(f"event={ev.get('title', '?')} on {ev.get('date', '?')}")
        issues = get_calendar_readiness_issues(parsed)
        if issues:
            parts.append(f"calendar pending: {', '.join(issues)}")
    if parsed.get("needs_response"):
        parts.append("needs response")
    return " | ".join(parts)
