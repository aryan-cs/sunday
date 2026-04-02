"""
email_parser.py — LLM-powered email parsing.

Sends each email through the active LLM and gets back a structured
JSON dict describing whether the email contains an event, what the
event details are, action items, urgency, etc.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta
from email.utils import getaddresses, parseaddr
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
    priority_score: int = 3
    priority_reason: str = ""
    summary: str
    event: ParsedEvent | None = None
    action_items: list[str] = Field(default_factory=list)
    can_wait: bool

    @field_validator("priority_score")
    @classmethod
    def _clamp_priority_score(cls, v: int) -> int:
        return max(1, min(5, v))

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
  "priority_score": <integer 1-5, how relevant this email is to the user's stated priorities. Default 3 if no priorities configured>,
  "priority_reason": "<one sentence explaining the score, e.g. 'Discusses internship interview mentioned in user priorities'>",
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

_SMALL_TITLE_WORDS = {
    "a",
    "an",
    "and",
    "as",
    "at",
    "but",
    "by",
    "for",
    "from",
    "in",
    "nor",
    "of",
    "on",
    "or",
    "the",
    "to",
    "up",
    "via",
    "with",
}
_UPPERCASE_ADDRESS_TOKENS = {
    "n",
    "s",
    "e",
    "w",
    "ne",
    "nw",
    "se",
    "sw",
    "al",
    "ak",
    "az",
    "ar",
    "ca",
    "co",
    "ct",
    "dc",
    "de",
    "fl",
    "ga",
    "hi",
    "ia",
    "id",
    "il",
    "in",
    "ks",
    "ky",
    "la",
    "ma",
    "md",
    "me",
    "mi",
    "mn",
    "mo",
    "ms",
    "mt",
    "nc",
    "nd",
    "ne",
    "nh",
    "nj",
    "nm",
    "nv",
    "ny",
    "oh",
    "ok",
    "or",
    "pa",
    "ri",
    "sc",
    "sd",
    "tn",
    "tx",
    "ut",
    "va",
    "vt",
    "wa",
    "wi",
    "wv",
    "wy",
    "uiuc",
    "ece",
    "eceb",
    "cs",
    "csl",
}


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
    return _display_name(name, address)


def _display_name(name: str, address: str) -> str | None:
    """Return a human-readable name for an email identity."""
    cleaned_name = name.strip().strip('"')
    if cleaned_name:
        return cleaned_name

    local_part = address.split("@", 1)[0].replace(".", " ").replace("_", " ").strip()
    if local_part:
        return " ".join(piece.capitalize() for piece in local_part.split())

    return None


def _normalise_email(address: str) -> str:
    """Return a lowercase email address for comparisons."""
    return address.strip().lower()


def _normalise_text(text: str) -> str:
    """Return a lowercase alphanumeric-only string for fuzzy matching."""
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def _natural_join(values: list[str]) -> str:
    """Join names in a compact natural-language form."""
    if not values:
        return ""
    if len(values) == 1:
        return values[0]
    if len(values) == 2:
        return f"{values[0]} and {values[1]}"
    return f"{', '.join(values[:-1])}, and {values[-1]}"


def _capitalize_core_word(
    word: str,
    *,
    is_first: bool,
    location_mode: bool,
    sentence_mode: bool,
) -> str:
    """Capitalize one word while preserving common small words and address tokens."""
    if not word:
        return word

    lower = word.lower()
    if location_mode and lower in _UPPERCASE_ADDRESS_TOKENS:
        return lower.upper()
    if word.isupper() and len(word) <= 5:
        return word
    if lower in _SMALL_TITLE_WORDS and not is_first:
        return lower
    if any(char.isdigit() for char in word):
        return word[0].upper() + word[1:] if word[0].isalpha() else word
    if sentence_mode and not is_first:
        if word[:1].isupper():
            return word
        return lower
    return word[0].upper() + word[1:].lower()


def _capitalize_token(
    token: str,
    *,
    is_first: bool,
    location_mode: bool,
    sentence_mode: bool,
) -> str:
    """Capitalize a token while preserving punctuation and separators."""
    if not token or token.isspace():
        return token

    match = re.match(r"^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$", token)
    if not match:
        return token

    prefix, core, suffix = match.groups()
    if not core:
        return token

    if "/" in core and core.lower() != "w/":
        parts = core.split("/")
        rebuilt = "/".join(
            _capitalize_core_word(
                part,
                is_first=is_first and index == 0,
                location_mode=location_mode,
                sentence_mode=sentence_mode,
            )
            for index, part in enumerate(parts)
        )
        return f"{prefix}{rebuilt}{suffix}"

    if "-" in core:
        parts = core.split("-")
        rebuilt = "-".join(
            _capitalize_core_word(
                part,
                is_first=is_first and index == 0,
                location_mode=location_mode,
                sentence_mode=sentence_mode,
            )
            for index, part in enumerate(parts)
        )
        return f"{prefix}{rebuilt}{suffix}"

    if core.lower().endswith("'s") and len(core) > 2:
        rebuilt = _capitalize_core_word(
            core[:-2],
            is_first=is_first,
            location_mode=location_mode,
            sentence_mode=sentence_mode,
        ) + "'s"
        return f"{prefix}{rebuilt}{suffix}"

    rebuilt = _capitalize_core_word(
        core,
        is_first=is_first,
        location_mode=location_mode,
        sentence_mode=sentence_mode,
    )
    return f"{prefix}{rebuilt}{suffix}"


def _smart_capitalize_phrase(
    text: str,
    *,
    location_mode: bool = False,
    sentence_mode: bool = False,
) -> str:
    """Apply readable capitalization to titles, names, and raw location strings."""
    pieces = re.split(r"(\s+)", text.strip())
    result: list[str] = []
    seen_word = False

    for piece in pieces:
        if not piece:
            continue
        if piece.isspace():
            result.append(piece)
            continue

        result.append(
            _capitalize_token(
                piece,
                is_first=not seen_word,
                location_mode=location_mode,
                sentence_mode=sentence_mode,
            )
        )
        if re.search(r"[A-Za-z0-9]", piece):
            seen_word = True

    return "".join(result).strip()


def _apply_exact_name_casing(text: str, names: list[str]) -> str:
    """Replace case-insensitive name matches with their exact preferred casing."""
    result = text
    for name in sorted({name.strip() for name in names if name and name.strip()}, key=len, reverse=True):
        result = re.sub(re.escape(name), name, result, flags=re.IGNORECASE)
    return result


def _other_party_names(parsed: dict, email_data: dict) -> list[str]:
    """Return the human names of participants other than the signed-in Gmail user."""
    user_email = _normalise_email(str(email_data.get("account_email", "")))
    seen: set[str] = set()
    user_identity_keys: set[str] = set()
    parties: list[str] = []

    for header_name in ("from", "to", "cc"):
        header_value = email_data.get(header_name, "")
        for name, address in getaddresses([header_value]):
            normalized_address = _normalise_email(address)
            display = _display_name(name, address)

            if user_email and normalized_address == user_email:
                if display:
                    user_identity_keys.add(_normalise_text(display))
                continue

            if not display:
                continue

            dedupe_key = normalized_address or _normalise_text(display)
            if not dedupe_key or dedupe_key in seen:
                continue

            seen.add(dedupe_key)
            seen.add(_normalise_text(display))
            parties.append(display)

    organizer = ((parsed.get("event") or {}).get("organizer") or "").strip()
    organizer_key = _normalise_text(organizer)
    if organizer and organizer_key and organizer_key not in seen and organizer_key not in user_identity_keys:
        seen.add(organizer_key)
        parties.append(organizer)

    return parties


def _title_mentions_name(title: str, name: str) -> bool:
    """Return true when a title already appears to mention a participant name."""
    normalized_title = _normalise_text(title)
    normalized_name = _normalise_text(name)
    if normalized_name and normalized_name in normalized_title:
        return True

    meaningful_parts = [part for part in re.split(r"\s+", name) if len(part) > 2]
    return any(_normalise_text(part) in normalized_title for part in meaningful_parts)


def _ensure_title_mentions_parties(title: str, party_names: list[str]) -> str:
    """Append other participants to an existing title when they are missing."""
    missing = [name for name in party_names if not _title_mentions_name(title, name)]
    if not missing:
        return title

    joined_missing = _natural_join(missing)
    if re.search(r"\bwith\b", title, re.IGNORECASE):
        return f"{title} and {joined_missing}"
    return f"{title} with {joined_missing}"


def _infer_event_title(parsed: dict, email_data: dict) -> str | None:
    """Infer a concise event title from the parsed summary, body, and sender."""
    context = _event_context_text(parsed, email_data)
    other_parties = _other_party_names(parsed, email_data)
    joined_parties = _natural_join(other_parties)

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
            if joined_parties and title_base in {"Lunch", "Breakfast", "Brunch", "Dinner", "Coffee"}:
                return f"{title_base} with {joined_parties}"
            if joined_parties and title_base in {"Interview", "Meeting", "Phone Screen"}:
                return f"{title_base} with {joined_parties}"
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

    if event.get("title"):
        event["title"] = _ensure_title_mentions_parties(
            event["title"],
            _other_party_names(parsed, email_data),
        )

    exact_names = _other_party_names(parsed, email_data)
    organizer = (event.get("organizer") or "").strip()
    if organizer:
        organizer = _smart_capitalize_phrase(organizer)
        event["organizer"] = organizer
        exact_names.append(organizer)

    if event.get("title"):
        event["title"] = _smart_capitalize_phrase(event["title"], sentence_mode=True)
        event["title"] = _apply_exact_name_casing(event["title"], exact_names)

    if event.get("location"):
        event["location"] = _smart_capitalize_phrase(event["location"], location_mode=True)

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

    system = EMAIL_PARSER_SYSTEM_PROMPT
    if Config.priority_context:
        system += (
            f"\n\nUSER PRIORITIES: {Config.priority_context}\n"
            "Use this to inform the priority_score field (1=irrelevant, 5=critical)."
        )

    try:
        parsed = await parse_with_json(
            prompt=user_prompt,
            system=system,
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
