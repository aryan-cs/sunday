from __future__ import annotations

import pytest

from errors import MessagingDeliveryError
from pipeline import process_single_email


class _FakeGmail:
    def __init__(self):
        self.processed_ids = []

    def mark_as_processed(self, message_id: str) -> None:
        self.processed_ids.append(message_id)


class _FakeCalendar:
    def create_smart_event(self, parsed_event, travel_info=None, source_email_id=None):
        del parsed_event, travel_info, source_email_id
        return {
            "status": "created",
            "event": {"htmlLink": "https://calendar.google.com/event"},
        }


class _FakeTravel:
    async def estimate(self, destination, departure_time=None, origin=None):
        del destination, departure_time, origin
        return {"travel_minutes": 25, "departure_time": "1:20 PM"}


@pytest.mark.anyio
async def test_process_single_email_marks_processed_after_success(monkeypatch):
    async def fake_parse_email(email_data):
        del email_data
        return {
            "has_event": True,
            "needs_response": False,
            "urgency": "low",
            "summary": "Weekly sync",
            "event": {
                "title": "Weekly Sync",
                "date": "2026-04-02",
                "start_time": "14:00",
                "end_time": "15:00",
                "is_online": True,
            },
            "action_items": [],
            "can_wait": True,
        }

    async def fake_send_summary(**kwargs):
        return None

    monkeypatch.setattr("pipeline.parse_email", fake_parse_email)
    monkeypatch.setattr("pipeline.send_summary", fake_send_summary)

    gmail = _FakeGmail()
    result = await process_single_email(
        {"id": "gmail-1", "subject": "hello"},
        gmail,
        _FakeCalendar(),
        _FakeTravel(),
    )

    assert gmail.processed_ids == ["gmail-1"]
    assert result["calendar_status"] == "created"


@pytest.mark.anyio
async def test_process_single_email_leaves_message_unprocessed_on_summary_failure(monkeypatch):
    async def fake_parse_email(email_data):
        del email_data
        return {
            "has_event": False,
            "needs_response": False,
            "urgency": "none",
            "summary": "FYI",
            "event": None,
            "action_items": [],
            "can_wait": True,
        }

    async def fake_send_summary(**kwargs):
        raise MessagingDeliveryError("boom")

    monkeypatch.setattr("pipeline.parse_email", fake_parse_email)
    monkeypatch.setattr("pipeline.send_summary", fake_send_summary)

    gmail = _FakeGmail()

    with pytest.raises(MessagingDeliveryError):
        await process_single_email(
            {"id": "gmail-2", "subject": "hello"},
            gmail,
            _FakeCalendar(),
            _FakeTravel(),
        )

    assert gmail.processed_ids == []
