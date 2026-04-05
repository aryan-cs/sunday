from __future__ import annotations

from backend.transcript_agent import ExtractedCalendarEvent, ExtractedReminder


def test_calendar_event_time_coercion_accepts_natural_time_strings():
    event = ExtractedCalendarEvent(
        title="Gym session",
        date="2026-04-06",
        start_time="2 p.m.",
        end_time="3 PM",
    )

    assert event.start_time == "14:00"
    assert event.end_time == "15:00"


def test_calendar_event_date_coercion_accepts_common_formats():
    event = ExtractedCalendarEvent(
        title="Gym session",
        date="04/06/2026",
        start_time="14:00",
        end_time="15:00",
    )

    assert event.date == "2026-04-06"


def test_reminder_deadline_coercion_accepts_common_formats():
    reminder = ExtractedReminder(task="Call plumber", deadline="04-05-2026")
    assert reminder.deadline == "2026-04-05"
