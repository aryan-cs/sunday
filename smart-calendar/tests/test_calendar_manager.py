from __future__ import annotations

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
            "is_online": True,
            "attendees": [],
        },
        source_email_id="gmail-123",
    )

    assert result["status"] == "created"
    assert events.insert_calls[0]["body"]["extendedProperties"]["private"]["smartCalendarEmailId"] == "gmail-123"
