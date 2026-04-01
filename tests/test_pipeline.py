from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from calendar_manager import CalendarManager
from errors import MessagingDeliveryError, TravelEstimationError
from pipeline import process_single_email, send_due_leave_alerts


class _FakeGmail:
    def __init__(self):
        self.processed_ids = []

    def mark_as_processed(self, message_id: str) -> None:
        self.processed_ids.append(message_id)


class _FakeCalendar:
    def __init__(self, day_events=None, window_events=None):
        self.last_event = None
        self.day_events = day_events or []
        self.window_events = window_events or []

    def create_smart_event(self, parsed_event, travel_info=None, source_email_id=None):
        del travel_info, source_email_id
        self.last_event = parsed_event
        return {
            "status": "created",
            "event": {"htmlLink": "https://calendar.google.com/event"},
        }

    def list_events_for_day(self, target_date=None):
        del target_date
        return list(self.day_events)

    def list_events_in_window(self, start_dt, end_dt):
        del start_dt, end_dt
        return list(self.window_events)


class _FakeTravel:
    def __init__(self):
        self.last_estimate_args = None
        self.last_resolve_args = None

    async def resolve_destination(self, destination, context_text=None, origin_bias=None, origin_context=None):
        self.last_resolve_args = {
            "destination": destination,
            "context_text": context_text,
            "origin_bias": origin_bias,
            "origin_context": origin_context,
        }
        if destination == "Illini Union":
            return {
                "canonical_name": None,
                "formatted_address": "1401 W Green St, Urbana, IL 61801",
                "display_location": "Illini Union (1401 W Green St, Urbana, IL 61801)",
                "calendar_location": "1401 W Green St, Urbana, IL 61801",
                "routing_destination": "1401 W Green St, Urbana, IL 61801",
            }
        return {
            "canonical_name": None,
            "formatted_address": destination,
            "display_location": destination,
            "calendar_location": destination,
            "routing_destination": destination,
        }

    async def estimate(
        self,
        destination,
        departure_time=None,
        origin=None,
        origin_label=None,
        origin_source=None,
    ):
        self.last_estimate_args = {
            "destination": destination,
            "departure_time": departure_time,
            "origin": origin,
            "origin_label": origin_label,
            "origin_source": origin_source,
        }
        return {"travel_minutes": 25, "departure_time": "1:20 PM"}


class _ResolveDeniedTravel(_FakeTravel):
    async def resolve_destination(self, destination, context_text=None, origin_bias=None, origin_context=None):
        del destination, context_text, origin_bias, origin_context
        raise TravelEstimationError("Google Maps could not resolve destination 'Illini Union': REQUEST_DENIED.")


class _EstimateDeniedTravel(_FakeTravel):
    async def estimate(
        self,
        destination,
        departure_time=None,
        origin=None,
        origin_label=None,
        origin_source=None,
    ):
        del destination, departure_time, origin, origin_label, origin_source
        raise TravelEstimationError(
            "Google Maps could not estimate travel for destination 'Illini Union': REQUEST_DENIED."
        )


@pytest.mark.anyio
async def test_process_single_email_marks_processed_after_success(monkeypatch):
    send_kwargs = {}

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
        send_kwargs.update(kwargs)
        return None

    monkeypatch.setattr("pipeline.parse_email", fake_parse_email)
    monkeypatch.setattr("pipeline.send_summary", fake_send_summary)

    gmail = _FakeGmail()
    result = await process_single_email(
        {"id": "gmail-1", "thread_id": "thread-1", "subject": "hello"},
        gmail,
        _FakeCalendar(),
        _FakeTravel(),
    )

    assert gmail.processed_ids == ["gmail-1"]
    assert result["calendar_status"] == "created"
    assert send_kwargs["source_email_link"] == "https://mail.google.com/mail/u/0/#all/thread-1"


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


@pytest.mark.anyio
async def test_process_single_email_enriches_missing_title_and_end_time(monkeypatch):
    async def fake_parse_email(email_data):
        del email_data
        return {
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
            },
            "action_items": ["Meet Aryan Gupta for lunch at Illini Union at 3:00 PM"],
            "can_wait": True,
        }

    async def fake_send_summary(**kwargs):
        del kwargs
        return None

    monkeypatch.setattr("pipeline.parse_email", fake_parse_email)
    monkeypatch.setattr("pipeline.send_summary", fake_send_summary)

    calendar = _FakeCalendar()
    gmail = _FakeGmail()

    result = await process_single_email(
        {
            "id": "gmail-3",
            "thread_id": "thread-3",
            "from": "Aryan Gupta <aryan05g@gmail.com>",
            "to": "User <me@example.com>",
            "account_email": "me@example.com",
            "subject": "",
            "body": "hey meet me for lunch at the illini union at 3:00 pm today",
        },
        gmail,
        calendar,
        _FakeTravel(),
    )

    assert result["calendar_status"] == "created"
    assert calendar.last_event["title"] == "Lunch with Aryan Gupta"
    assert calendar.last_event["end_time"] == "16:00"
    assert calendar.last_event["location"] == "Illini Union (1401 W Green St, Urbana, IL 61801)"


@pytest.mark.anyio
async def test_process_single_email_adds_other_party_names_to_generic_event_title(monkeypatch):
    async def fake_parse_email(email_data):
        del email_data
        return {
            "has_event": True,
            "needs_response": False,
            "urgency": "low",
            "summary": "Lunch meeting at Illini Union today",
            "event": {
                "title": "Lunch meeting",
                "date": "2026-04-01",
                "start_time": "15:00",
                "end_time": "16:00",
                "location": "Illini Union",
                "is_online": False,
            },
            "action_items": [],
            "can_wait": True,
        }

    async def fake_send_summary(**kwargs):
        del kwargs
        return None

    monkeypatch.setattr("pipeline.parse_email", fake_parse_email)
    monkeypatch.setattr("pipeline.send_summary", fake_send_summary)

    calendar = _FakeCalendar()
    gmail = _FakeGmail()

    result = await process_single_email(
        {
            "id": "gmail-3b",
            "thread_id": "thread-3b",
            "from": "Aryan Gupta <aryan05g@gmail.com>",
            "to": "User <me@example.com>",
            "account_email": "me@example.com",
            "subject": "",
            "body": "hey meet me for lunch at the illini union at 3:00 pm today",
        },
        gmail,
        calendar,
        _FakeTravel(),
    )

    assert result["calendar_status"] == "created"
    assert calendar.last_event["title"] == "Lunch meeting with Aryan Gupta"


@pytest.mark.anyio
async def test_process_single_email_still_creates_event_when_exact_address_lookup_fails(monkeypatch):
    async def fake_parse_email(email_data):
        del email_data
        return {
            "has_event": True,
            "needs_response": False,
            "urgency": "low",
            "summary": "Lunch today",
            "event": {
                "title": "Lunch with Aryan Gupta",
                "date": "2026-04-01",
                "start_time": "15:00",
                "end_time": "16:00",
                "location": "Illini Union",
                "is_online": False,
            },
            "action_items": [],
            "can_wait": True,
        }

    async def fake_send_summary(**kwargs):
        del kwargs
        return None

    monkeypatch.setattr("pipeline.parse_email", fake_parse_email)
    monkeypatch.setattr("pipeline.send_summary", fake_send_summary)

    calendar = _FakeCalendar()
    gmail = _FakeGmail()

    result = await process_single_email(
        {"id": "gmail-4", "thread_id": "thread-4", "body": "lunch"},
        gmail,
        calendar,
        _ResolveDeniedTravel(),
    )

    assert result["calendar_status"] == "created"
    assert calendar.last_event["location"] == "Illini Union"
    assert any("Exact address lookup unavailable" in note for note in result["processing_notes"])


@pytest.mark.anyio
async def test_process_single_email_still_creates_event_when_travel_estimate_fails(monkeypatch):
    async def fake_parse_email(email_data):
        del email_data
        return {
            "has_event": True,
            "needs_response": False,
            "urgency": "low",
            "summary": "Lunch today",
            "event": {
                "title": "Lunch with Aryan Gupta",
                "date": "2026-04-01",
                "start_time": "15:00",
                "end_time": "16:00",
                "location": "Illini Union",
                "is_online": False,
            },
            "action_items": [],
            "can_wait": True,
        }

    async def fake_send_summary(**kwargs):
        del kwargs
        return None

    monkeypatch.setattr("pipeline.parse_email", fake_parse_email)
    monkeypatch.setattr("pipeline.send_summary", fake_send_summary)

    calendar = _FakeCalendar()
    gmail = _FakeGmail()

    result = await process_single_email(
        {"id": "gmail-5", "thread_id": "thread-5", "body": "lunch"},
        gmail,
        calendar,
        _EstimateDeniedTravel(),
    )

    assert result["calendar_status"] == "created"
    assert any("Travel estimate unavailable" in note for note in result["processing_notes"])


@pytest.mark.anyio
async def test_process_single_email_uses_work_origin_during_work_hours(monkeypatch):
    async def fake_parse_email(email_data):
        del email_data
        return {
            "has_event": True,
            "needs_response": False,
            "urgency": "low",
            "summary": "Coffee chat this afternoon",
            "event": {
                "title": "Coffee with Aryan Gupta",
                "date": "2026-04-01",
                "start_time": "14:00",
                "end_time": "14:30",
                "location": "Illini Union",
                "is_online": False,
            },
            "action_items": [],
            "can_wait": True,
        }

    async def fake_send_summary(**kwargs):
        del kwargs
        return None

    monkeypatch.setattr("pipeline.parse_email", fake_parse_email)
    monkeypatch.setattr("pipeline.send_summary", fake_send_summary)
    monkeypatch.setattr("pipeline.Config.default_home_location", "Home")
    monkeypatch.setattr("pipeline.Config.default_home_lat", None)
    monkeypatch.setattr("pipeline.Config.default_home_lng", None)
    monkeypatch.setattr("pipeline.Config.default_work_location", "Office")
    monkeypatch.setattr("pipeline.Config.default_work_lat", None)
    monkeypatch.setattr("pipeline.Config.default_work_lng", None)
    monkeypatch.setattr("pipeline.Config.work_days", ["wed"])
    monkeypatch.setattr("pipeline.Config.workday_start_time", "09:00")
    monkeypatch.setattr("pipeline.Config.workday_end_time", "17:00")

    calendar = _FakeCalendar()
    gmail = _FakeGmail()
    travel = _FakeTravel()

    result = await process_single_email(
        {"id": "gmail-7", "thread_id": "thread-7", "body": "coffee"},
        gmail,
        calendar,
        travel,
    )

    assert result["calendar_status"] == "created"
    assert travel.last_estimate_args["origin"] == "Office"
    assert travel.last_estimate_args["origin_label"] == "Office"
    assert travel.last_estimate_args["origin_source"] == "work"
    assert travel.last_resolve_args["origin_bias"] == "Office"
    assert travel.last_resolve_args["origin_context"] == "Office"


@pytest.mark.anyio
async def test_process_single_email_uses_home_origin_outside_work_hours(monkeypatch):
    async def fake_parse_email(email_data):
        del email_data
        return {
            "has_event": True,
            "needs_response": False,
            "urgency": "low",
            "summary": "Dinner tonight",
            "event": {
                "title": "Dinner with Aryan Gupta",
                "date": "2026-04-01",
                "start_time": "19:00",
                "end_time": "20:30",
                "location": "Downtown Champaign",
                "is_online": False,
            },
            "action_items": [],
            "can_wait": True,
        }

    async def fake_send_summary(**kwargs):
        del kwargs
        return None

    monkeypatch.setattr("pipeline.parse_email", fake_parse_email)
    monkeypatch.setattr("pipeline.send_summary", fake_send_summary)
    monkeypatch.setattr("pipeline.Config.default_home_location", "Home")
    monkeypatch.setattr("pipeline.Config.default_home_lat", None)
    monkeypatch.setattr("pipeline.Config.default_home_lng", None)
    monkeypatch.setattr("pipeline.Config.default_work_location", "Office")
    monkeypatch.setattr("pipeline.Config.default_work_lat", None)
    monkeypatch.setattr("pipeline.Config.default_work_lng", None)
    monkeypatch.setattr("pipeline.Config.work_days", ["wed"])
    monkeypatch.setattr("pipeline.Config.workday_start_time", "09:00")
    monkeypatch.setattr("pipeline.Config.workday_end_time", "17:00")

    calendar = _FakeCalendar()
    gmail = _FakeGmail()
    travel = _FakeTravel()

    result = await process_single_email(
        {"id": "gmail-8", "thread_id": "thread-8", "body": "dinner"},
        gmail,
        calendar,
        travel,
    )

    assert result["calendar_status"] == "created"
    assert travel.last_estimate_args["origin"] == "Home"
    assert travel.last_estimate_args["origin_source"] == "home"


@pytest.mark.anyio
async def test_process_single_email_uses_latest_prior_calendar_location_as_origin(monkeypatch):
    async def fake_parse_email(email_data):
        del email_data
        return {
            "has_event": True,
            "needs_response": False,
            "urgency": "low",
            "summary": "Lunch meeting",
            "event": {
                "title": "Lunch meeting with Aryan Gupta",
                "date": "2026-04-01",
                "start_time": "15:00",
                "end_time": "16:00",
                "location": "Illini Union",
                "is_online": False,
            },
            "action_items": [],
            "can_wait": True,
        }

    async def fake_send_summary(**kwargs):
        del kwargs
        return None

    monkeypatch.setattr("pipeline.parse_email", fake_parse_email)
    monkeypatch.setattr("pipeline.send_summary", fake_send_summary)
    monkeypatch.setattr("pipeline.Config.default_home_location", "Home")
    monkeypatch.setattr("pipeline.Config.default_work_location", "Office")

    calendar = _FakeCalendar(
        day_events=[
            {
                "summary": "Classes",
                "location": "Siebel Center",
                "start": {"dateTime": "2026-04-01T13:00:00-05:00"},
                "end": {"dateTime": "2026-04-01T14:30:00-05:00"},
            }
        ]
    )
    gmail = _FakeGmail()
    travel = _FakeTravel()

    result = await process_single_email(
        {"id": "gmail-9", "thread_id": "thread-9", "body": "lunch"},
        gmail,
        calendar,
        travel,
    )

    assert result["calendar_status"] == "created"
    assert travel.last_estimate_args["origin"] == "Siebel Center"
    assert travel.last_estimate_args["origin_source"] == "calendar_context"


@pytest.mark.anyio
async def test_process_single_email_replaces_typoed_venue_name_in_title(monkeypatch):
    async def fake_parse_email(email_data):
        del email_data
        return {
            "has_event": True,
            "needs_response": False,
            "urgency": "low",
            "summary": "Dinner at Oozu Rameern tonight",
            "event": {
                "title": "Dinner at Oozu Rameern with Aryan Gupta",
                "date": "2026-04-01",
                "start_time": "21:00",
                "end_time": "22:00",
                "location": "Oozu Rameern",
                "is_online": False,
            },
            "action_items": [],
            "can_wait": True,
        }

    class _CanonicalizingTravel(_FakeTravel):
        async def resolve_destination(self, destination, context_text=None, origin_bias=None, origin_context=None):
            del destination, context_text, origin_bias, origin_context
            return {
                "canonical_name": "Oozu Ramen",
                "formatted_address": "601 S 6th St #102, Champaign, IL 61820",
                "display_location": "Oozu Ramen (601 S 6th St #102, Champaign, IL 61820)",
                "calendar_location": "Oozu Ramen, 601 S 6th St #102, Champaign, IL 61820",
                "routing_destination": "601 S 6th St #102, Champaign, IL 61820",
            }

    async def fake_send_summary(**kwargs):
        del kwargs
        return None

    monkeypatch.setattr("pipeline.parse_email", fake_parse_email)
    monkeypatch.setattr("pipeline.send_summary", fake_send_summary)

    calendar = _FakeCalendar()
    gmail = _FakeGmail()

    result = await process_single_email(
        {"id": "gmail-typo-1", "thread_id": "thread-typo-1", "body": "dinner"},
        gmail,
        calendar,
        _CanonicalizingTravel(),
    )

    assert result["calendar_status"] == "created"
    assert calendar.last_event["title"] == "Dinner at Oozu Ramen with Aryan Gupta"
    assert calendar.last_event["location"] == "Oozu Ramen (601 S 6th St #102, Champaign, IL 61820)"
    assert calendar.last_event["calendar_location"] == "Oozu Ramen, 601 S 6th St #102, Champaign, IL 61820"


@pytest.mark.anyio
async def test_send_due_leave_alerts_sends_due_text_once(monkeypatch, tmp_path):
    sent_messages: list[str] = []

    async def fake_send_text_message(message: str, follow_up_link: str | None = None):
        del follow_up_link
        sent_messages.append(message)
        return None

    monkeypatch.setattr("pipeline.send_text_message", fake_send_text_message)
    monkeypatch.setattr("pipeline.Config.state_dir", str(tmp_path))

    calendar = _FakeCalendar(
        window_events=[
            {
                "id": "evt-1",
                "summary": "Dinner meeting with Aryan Gupta",
                "location": "Oozu Ramen (601 S 6th St #102, Champaign, IL 61820)",
                "start": {"dateTime": "2026-04-01T19:00:00-05:00"},
                "extendedProperties": {
                    "private": {
                        CalendarManager.LEAVE_ALERT_AT_PROPERTY: "2026-04-01T18:41:00-05:00"
                    }
                },
            }
        ]
    )
    now = datetime(2026, 4, 1, 18, 45, tzinfo=ZoneInfo("America/Chicago"))

    first = await send_due_leave_alerts(calendar=calendar, now=now)
    second = await send_due_leave_alerts(calendar=calendar, now=now + timedelta(minutes=1))

    assert first == [{"event_id": "evt-1", "summary": "Dinner meeting with Aryan Gupta", "status": "sent"}]
    assert second == []
    assert len(sent_messages) == 1
    assert sent_messages[0].startswith("‼️ hey, it's time to leave for dinner at oozu ramen w/ aryan!")
    assert "location: Oozu Ramen (601 S 6th St #102, Champaign, IL 61820)" in sent_messages[0]
