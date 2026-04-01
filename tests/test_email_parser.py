from __future__ import annotations

import pytest

from email_parser import EmailParseError, enrich_event_details, get_calendar_readiness_issues, parse_email


@pytest.mark.anyio
async def test_parse_email_returns_validated_data(monkeypatch):
    async def fake_parse_with_json(**kwargs):
        return {
            "has_event": True,
            "needs_response": False,
            "urgency": "medium",
            "summary": "Team sync tomorrow at 2 PM.",
            "event": {
                "title": "Team Sync",
                "date": "2026-04-02",
                "start_time": "14:00",
                "end_time": "15:00",
                "location": None,
                "is_online": True,
                "meeting_link": "https://meet.example.com/abc",
                "description": "Weekly sync",
                "attendees": ["one@example.com", "two@example.com"],
                "organizer": "Alice",
            },
            "action_items": ["Prepare updates"],
            "can_wait": False,
        }

    monkeypatch.setattr("email_parser.parse_with_json", fake_parse_with_json)

    parsed = await parse_email({"id": "msg-1", "body": "hello"})

    assert parsed["summary"] == "Team sync tomorrow at 2 PM."
    assert parsed["event"]["title"] == "Team Sync"
    assert parsed["event"]["attendees"] == ["one@example.com", "two@example.com"]


@pytest.mark.anyio
async def test_parse_email_raises_on_invalid_structure(monkeypatch):
    async def fake_parse_with_json(**kwargs):
        return {
            "has_event": True,
            "needs_response": False,
            "urgency": "medium",
            "event": {"is_online": True},
            "action_items": [],
            "can_wait": False,
        }

    monkeypatch.setattr("email_parser.parse_with_json", fake_parse_with_json)

    with pytest.raises(EmailParseError):
        await parse_email({"id": "msg-2", "body": "hello"})


def test_calendar_readiness_issues_detect_missing_fields():
    issues = get_calendar_readiness_issues(
        {
            "has_event": True,
            "event": {
                "title": "Interview",
                "date": "2026-04-03",
                "start_time": None,
                "end_time": None,
                "is_online": False,
                "location": None,
            },
        }
    )

    assert "missing start time" in issues
    assert "missing end time" in issues
    assert "missing location for an in-person event" in issues


def test_enrich_event_details_infers_title_and_end_time_for_lunch_email():
    enriched = enrich_event_details(
        {
            "has_event": True,
            "needs_response": False,
            "urgency": "low",
            "summary": "Aryan Gupta wants to meet for lunch today",
            "event": {
                "title": None,
                "date": "2026-04-01",
                "start_time": "15:00",
                "end_time": None,
                "location": "Illini Union",
                "is_online": False,
                "meeting_link": None,
                "description": None,
                "attendees": [],
                "organizer": "Aryan Gupta",
            },
            "action_items": ["Meet Aryan Gupta for lunch at Illini Union at 3:00 PM"],
            "can_wait": True,
        },
        {
            "from": "Aryan Gupta <aryan05g@gmail.com>",
            "subject": "",
            "body": "hey meet me for lunch at the illini union at 3:00 pm today",
        },
    )

    assert enriched["event"]["title"] == "Lunch with Aryan Gupta"
    assert enriched["event"]["end_time"] == "16:00"
