from __future__ import annotations

from backend.server import (
    _action_center_entry_from_pipeline_result,
    _build_event_notes,
    _event_start_local_dt,
    _build_travel_warning_note,
    _extract_area_hint,
    _find_calendar_conflict,
    _has_restaurant_search_intent,
    _reminder_to_calendar_event,
)
from backend.transcript_agent import (
    ExtractedCalendarEvent,
    ExtractedInsight,
    ExtractedPrep,
    ExtractedReminder,
    ExtractedResearchItem,
    TranscriptActions,
)


def test_find_calendar_conflict_returns_matching_summary_for_overlap(monkeypatch):
    monkeypatch.setattr("backend.server.Config.timezone", "America/Chicago")
    existing = [
        {
            "summary": "Matrix architecture sync",
            "start": {"dateTime": "2026-04-05T10:00:00-05:00"},
            "end": {"dateTime": "2026-04-05T11:00:00-05:00"},
        }
    ]

    conflict = _find_calendar_conflict(
        existing_events=existing,
        event_date="2026-04-05",
        start_time="10:30",
        end_time="11:30",
    )

    assert conflict is not None
    assert conflict["summary"] == "Matrix architecture sync"


def test_find_calendar_conflict_returns_none_for_non_overlap(monkeypatch):
    monkeypatch.setattr("backend.server.Config.timezone", "America/Chicago")
    existing = [
        {
            "summary": "Matrix architecture sync",
            "start": {"dateTime": "2026-04-05T10:00:00-05:00"},
            "end": {"dateTime": "2026-04-05T11:00:00-05:00"},
        }
    ]

    conflict = _find_calendar_conflict(
        existing_events=existing,
        event_date="2026-04-05",
        start_time="11:30",
        end_time="12:30",
    )

    assert conflict is None


def test_has_restaurant_search_intent_detects_lookup_language():
    text = (
        "I'm meeting with Sarah at a Thai place tonight. "
        "Can you find a good highly rated Thai restaurant near West Lafayette?"
    )
    assert _has_restaurant_search_intent(text)


def test_extract_area_hint_parses_near_clause():
    text = "Find a good Thai restaurant near West Lafayette tonight."
    assert _extract_area_hint(text) == "West Lafayette"


def test_reminder_to_calendar_event_uses_deadline_and_priority():
    reminder = ExtractedReminder(task="Call plumber", deadline="2026-04-10", priority="high")
    event = _reminder_to_calendar_event(reminder, default_date="2026-04-05")
    assert event["title"] == "Reminder: Call plumber"
    assert event["date"] == "2026-04-10"
    assert event["start_time"] == "09:00"
    assert event["end_time"] == "09:30"
    assert event["is_online"] is True
    assert "Priority: high." in event["description"]


def test_build_event_notes_includes_context_links_and_schedule_warning(monkeypatch):
    monkeypatch.setattr("backend.server.Config.timezone", "America/Chicago")
    actions = TranscriptActions(
        social_insights=[
            ExtractedInsight(person="Aryan Gupta", insight="Peanut allergy", category="dietary")
        ],
        preparation_items=[
            ExtractedPrep(topic="Dinner with Aryan Gupta", suggestion="Pick peanut-safe options")
        ],
        research_items=[
            ExtractedResearchItem(
                title="Allergy-safe Thai options",
                url="https://example.com/thai-safe",
                snippet=None,
                source="web",
            )
        ],
    )
    event = ExtractedCalendarEvent(
        title="Dinner with Aryan Gupta",
        date="2026-04-05",
        start_time="19:00",
        end_time="20:00",
        location="New Place",
    )
    existing = [
        {
            "summary": "Office sync",
            "location": "Campus Office",
            "end": {"dateTime": "2026-04-05T18:30:00-05:00"},
        }
    ]
    notes = _build_event_notes(actions, event, existing)

    assert notes is not None
    assert "Smart notes:" in notes
    assert "Aryan Gupta: Peanut allergy" in notes
    assert "Prep:" in notes
    assert "Helpful links:" in notes
    assert "Tight turnaround:" in notes


def test_build_travel_warning_note_mentions_mode_and_minutes(monkeypatch):
    monkeypatch.setattr("backend.server.Config.travel_mode", "walking")
    future_start = ExtractedCalendarEvent(
        title="Dinner",
        date="2099-01-01",
        start_time="19:00",
    )
    start_dt = _event_start_local_dt(future_start.date, future_start.start_time)
    warning = _build_travel_warning_note(
        start_dt,
        {
            "travel_minutes": 52,
            "travel_text": "52 mins",
            "origin": "Home",
            "origin_source": "home",
        },
    )
    assert warning is not None
    assert "52 min walk" in warning


def test_action_center_entry_from_pipeline_result_maps_email_event():
    result = {
        "email_id": "abc123",
        "subject": "Dinner plans",
        "has_event": True,
        "event": {
            "title": "Dinner with Sam",
            "date": "2026-04-06",
            "start_time": "19:00",
            "end_time": "20:00",
            "location": "Downtown",
            "is_online": False,
        },
        "calendar_status": "created",
        "calendar_event_link": "https://calendar.google.com/event?eid=abc",
        "summary": "Dinner tomorrow",
        "processing_notes": ["Travel estimate unavailable: missing maps key"],
    }
    entry = _action_center_entry_from_pipeline_result(result)
    assert entry is not None
    assert entry["id"] == "email-abc123"
    assert entry["status"] == "complete"
    assert entry["actions"][0]["type"] == "calendar_event"
    assert entry["actions"][0]["title"] == "Dinner with Sam"
    assert "Calendar link:" in entry["transcript"]
