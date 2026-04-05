"""
transcript_agent.py — LLM-powered action extraction from voice memo transcripts.

Analyzes a transcript and returns structured actions: calendar events,
reminders, social insights, preparation items, and messages to send.
Contact context is injected when known people are mentioned.
"""
from __future__ import annotations

import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field, field_validator

from .config import Config
from .llm_client import LLMClient, parse_with_json

log = logging.getLogger(__name__)


def _coerce_yyyy_mm_dd(value: str | None) -> str | None:
    if value is None:
        return None
    raw = value.strip()
    if not raw:
        return None

    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%m/%d/%Y", "%m-%d-%Y"):
        try:
            parsed = datetime.strptime(raw, fmt)
            return parsed.strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def _coerce_hhmm(value: str | None) -> str | None:
    if value is None:
        return None
    raw = value.strip().lower()
    if not raw:
        return None

    normalized = (
        raw.replace(".", "")
        .replace(" a m", " am")
        .replace(" p m", " pm")
        .replace("a.m", "am")
        .replace("p.m", "pm")
    )

    for fmt in ("%H:%M", "%I:%M %p", "%I %p", "%I%p"):
        try:
            parsed = datetime.strptime(normalized, fmt)
            return parsed.strftime("%H:%M")
        except ValueError:
            continue
    return None


class ExtractedCalendarEvent(BaseModel):
    title: str
    date: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    location: str | None = None
    is_online: bool | None = None
    description: str | None = None
    executed: bool = False
    conflict: bool = False
    conflict_with: str | None = None

    @field_validator("date")
    @classmethod
    def _validate_date(cls, value: str | None) -> str | None:
        return _coerce_yyyy_mm_dd(value)

    @field_validator("start_time", "end_time")
    @classmethod
    def _validate_time(cls, value: str | None) -> str | None:
        return _coerce_hhmm(value)


class ExtractedReminder(BaseModel):
    task: str
    deadline: str | None = None
    priority: str = "medium"
    executed: bool = False

    @field_validator("priority")
    @classmethod
    def _validate_priority(cls, value: str) -> str:
        if value not in {"high", "medium", "low"}:
            return "medium"
        return value

    @field_validator("deadline")
    @classmethod
    def _validate_deadline(cls, value: str | None) -> str | None:
        return _coerce_yyyy_mm_dd(value)


class ExtractedInsight(BaseModel):
    person: str
    insight: str
    category: str = "other"

    @field_validator("category")
    @classmethod
    def _validate_category(cls, value: str) -> str:
        if value not in {"dietary", "preference", "avoid", "other"}:
            return "other"
        return value


class ExtractedPrep(BaseModel):
    topic: str
    suggestion: str


class ExtractedResearchItem(BaseModel):
    title: str
    url: str
    snippet: str | None = None
    source: str = "web"


class ExtractedMessage(BaseModel):
    recipient_name: str
    message: str
    phone: str | None = None   # filled in from contacts store before sending
    executed: bool = False


class TranscriptActions(BaseModel):
    calendar_events: list[ExtractedCalendarEvent] = Field(default_factory=list)
    reminders: list[ExtractedReminder] = Field(default_factory=list)
    social_insights: list[ExtractedInsight] = Field(default_factory=list)
    preparation_items: list[ExtractedPrep] = Field(default_factory=list)
    research_items: list[ExtractedResearchItem] = Field(default_factory=list)
    messages_to_send: list[ExtractedMessage] = Field(default_factory=list)


_SYSTEM_BASE = """\
You are a proactive personal assistant. Analyze the voice memo transcript and extract actionable items.

You MUST respond with ONLY valid JSON — no markdown, no explanation, no backticks.

Return exactly this JSON structure:

{
  "calendar_events": [
    {
      "title": "Event name",
      "date": "YYYY-MM-DD or null",
      "start_time": "HH:MM (24-hour) or null",
      "end_time": "HH:MM (24-hour) or null",
      "location": "Address or place name or null",
      "is_online": true/false/null,
      "description": "Brief description or null"
    }
  ],
  "reminders": [
    {
      "task": "What needs to be done",
      "deadline": "YYYY-MM-DD or null",
      "priority": "high | medium | low"
    }
  ],
  "social_insights": [
    {
      "person": "Person's name",
      "insight": "What to remember about them (e.g. allergy, preference, warning)",
      "category": "dietary | preference | avoid | other"
    }
  ],
  "preparation_items": [
    {
      "topic": "What the upcoming item is about",
      "suggestion": "What the user should do to prepare"
    }
  ],
  "research_items": [
    {
      "title": "Resource title",
      "url": "https://...",
      "snippet": "Why this is relevant",
      "source": "web | docs | notes"
    }
  ],
  "messages_to_send": [
    {
      "recipient_name": "First name or full name of person to text",
      "message": "Draft message text to send them"
    }
  ]
}

Rules:
- Only include items explicitly mentioned or clearly implied.
- Treat planning-intent phrasing with a concrete time/date (e.g. "I want to go to a gym session tomorrow at 2pm")
  as a calendar event candidate.
- Treat meeting/invite phrasing (e.g. "meeting", "dinner with", "catch up with") as calendar event intent.
- For meeting events, location and meeting link are optional. Keep the event with null fields when unknown.
- Use empty arrays [] when nothing is found in a category.
- If the user asks to "find" places/resources, include research_items with useful URLs when available.
- Parse dates relative to today's date (provided in the user message).
- "7 tonight" → 19:00, "noon" → 12:00, "9am" → 09:00.
- Use null for uncertain fields — do not guess.
- For reminders: treat "remind me", "don't forget", "remember to", and task-deadline phrasing as reminders.
- messages_to_send is only for contacting another person; never use messages_to_send for self-reminders.
- For messages_to_send: detect phrases like "I should let X know", "text X that", "tell X I'm running late".
- For social_insights: if contact context is provided below and the transcript implies a risk (e.g. food with someone who has an allergy), surface a warning insight.
"""

_CONTACT_CONTEXT_HEADER = "\n\n[Known contacts mentioned in this transcript]\n"


def _build_system_prompt(contact_context: str | None) -> str:
    if contact_context:
        return _SYSTEM_BASE + _CONTACT_CONTEXT_HEADER + contact_context
    return _SYSTEM_BASE


def _today_local() -> str:
    return datetime.now(ZoneInfo(Config.timezone)).date().isoformat()


async def extract_actions(
    transcript: str,
    today: str | None = None,
    llm: LLMClient | None = None,
    contact_context: str | None = None,
) -> TranscriptActions:
    """
    Analyze a transcript and return structured actions.

    Returns an empty TranscriptActions on any failure — always non-blocking.
    Pass contact_context to inject relevant contact profiles into the prompt.
    """
    if not transcript.strip():
        return TranscriptActions()

    effective_today = today or _today_local()
    prompt = f"Today's date: {effective_today}\n\nTranscript:\n{transcript[:4000]}"
    system = _build_system_prompt(contact_context)

    try:
        raw = await parse_with_json(
            prompt=prompt,
            system=system,
            client=llm,
            temperature=0.1,
        )
        return TranscriptActions.model_validate(raw)
    except Exception as exc:
        log.warning("Action extraction failed: %s", exc)
        return TranscriptActions()
