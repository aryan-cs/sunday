from __future__ import annotations

from datetime import datetime

from calendar_manager import CalendarManager


class _FakeRequest:
    def __init__(self, payload):
        self.payload = payload

    def execute(self):
        return self.payload


class _FakeEvents:
    def __init__(self, list_payload, insert_payload=None):
        self.list_payload = list_payload
        self.insert_payload = insert_payload or {"htmlLink": "https://calendar.google.com/new"}
        self.insert_calls = []
        self.list_calls = []

    def list(self, **kwargs):
        self.list_calls.append(kwargs)
        return _FakeRequest(self.list_payload)

    def insert(self, **kwargs):
        self.insert_calls.append(kwargs)
        return _FakeRequest(self.insert_payload)


class _FakeService:
    def __init__(self, events):
        self._events = events

    def events(self):
        return self._events


def test_calendar_manager_returns_existing_event_without_inserting(monkeypatch):
    events = _FakeEvents({"items": [{"id": "evt-1", "htmlLink": "https://calendar.google.com/existing"}]})
    manager = object.__new__(CalendarManager)
    manager.service = _FakeService(events)
    monkeypatch.setattr("calendar_manager.Config.timezone", "America/Chicago")

    result = manager.create_smart_event(
        {
            "title": "Team Sync",
            "date": "2026-04-02",
            "start_time": "14:00",
            "end_time": "15:00",
            "is_online": True,
            "attendees": [],
        },
        source_email_id="gmail-123",
    )

    assert result["status"] == "existing"
    assert events.insert_calls == []


def test_calendar_manager_sets_extended_property_on_insert(monkeypatch):
    events = _FakeEvents({"items": []})
    manager = object.__new__(CalendarManager)
    manager.service = _FakeService(events)
    monkeypatch.setattr("calendar_manager.Config.timezone", "America/Chicago")

    result = manager.create_smart_event(
        {
            "title": "Team Sync",
            "date": "2026-04-02",
            "start_time": "14:00",
            "end_time": "15:00",
            "is_online": False,
            "location": "Office",
            "attendees": [],
        },
        source_email_id="gmail-123",
        travel_info={"travel_minutes": 10, "departure_time": "1:35 PM"},
    )

    assert result["status"] == "created"
    assert events.insert_calls[0]["body"]["extendedProperties"]["private"]["smartCalendarEmailId"] == "gmail-123"
    assert (
        events.insert_calls[0]["body"]["extendedProperties"]["private"][
            CalendarManager.LEAVE_ALERT_AT_PROPERTY
        ]
        == "2026-04-02T13:35:00-05:00"
    )
    assert "attendees" not in events.insert_calls[0]["body"]


def test_compute_smart_reminders_skips_day_before_for_casual_lunch(monkeypatch):
    monkeypatch.setattr("calendar_manager.Config.prep_time", 15)

    reminders = CalendarManager._compute_smart_reminders(
        datetime(2026, 4, 1, 15, 0),
        {
            "title": "Lunch with Aryan Gupta",
            "description": "",
            "date": "2026-04-01",
            "start_time": "15:00",
            "end_time": "16:00",
            "is_online": False,
            "location": "Illini Union",
        },
        {"travel_minutes": 6},
    )

    assert {"method": "popup", "minutes": 21} in reminders
    assert {"method": "popup", "minutes": 51} in reminders
    assert {"method": "popup", "minutes": 1440} not in reminders


def test_compute_smart_reminders_keeps_day_before_for_interview(monkeypatch):
    monkeypatch.setattr("calendar_manager.Config.online_prep", 5)

    reminders = CalendarManager._compute_smart_reminders(
        datetime(2026, 4, 2, 9, 0),
        {
            "title": "Interview with Ramp",
            "description": "",
            "date": "2026-04-02",
            "start_time": "09:00",
            "end_time": "10:00",
            "is_online": True,
            "location": None,
        },
        None,
    )

    assert {"method": "popup", "minutes": 5} in reminders
    assert {"method": "popup", "minutes": 1440} in reminders


def test_build_description_formats_travel_sentence_for_selected_travel_type(monkeypatch):
    monkeypatch.setattr("calendar_manager.Config.travel_mode", "driving")

    description = CalendarManager._build_description(
        {
            "description": "",
            "meeting_link": None,
            "organizer": "Aryan Gupta",
        },
        {
            "travel_minutes": 3,
            "travel_text": "3 mins",
            "origin": "Campus Circle Urbana",
            "departure_time": "9:42 PM",
        },
    )

    assert description == "3 min drive from Campus Circle Urbana, leave by: 9:42 PM. organized by Aryan Gupta."


def test_build_description_uses_walk_phrase_when_travel_type_is_walking(monkeypatch):
    monkeypatch.setattr("calendar_manager.Config.travel_mode", "walking")

    description = CalendarManager._build_description(
        {
            "description": "",
            "meeting_link": None,
            "organizer": None,
        },
        {
            "travel_minutes": 18,
            "travel_text": "18 mins",
            "origin": "Campus Circle Urbana",
            "departure_time": "6:27 PM",
        },
    )

    assert description == "18 min walk from Campus Circle Urbana, leave by: 6:27 PM."


def test_build_description_uses_commute_phrase_for_transit(monkeypatch):
    monkeypatch.setattr("calendar_manager.Config.travel_mode", "transit")

    description = CalendarManager._build_description(
        {
            "description": "",
            "meeting_link": None,
            "organizer": "Aryan Gupta",
        },
        {
            "travel_minutes": 11,
            "travel_text": "11 mins",
            "origin": "Campus Circle Urbana",
            "departure_time": "8:34 PM",
        },
    )

    assert description == "11 min commute from Campus Circle Urbana, leave by: 8:34 PM. organized by Aryan Gupta."
