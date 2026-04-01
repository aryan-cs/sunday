"""
email_parser.py — LLM-powered email parsing.

Sends each email through the active LLM and gets back a structured
JSON dict describing whether the email contains an event, what the
event details are, action items, urgency, etc.
"""
from __future__ import annotations

import logging
from datetime import datetime
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


def _today_local_date() -> str:
    """Return today's date in the configured timezone."""
    return datetime.now(ZoneInfo(Config.timezone)).date().isoformat()


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
