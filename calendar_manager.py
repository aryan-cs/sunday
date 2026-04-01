"""
calendar_manager.py — Google Calendar smart event creation.

Creates fully-detailed calendar events from LLM-parsed email data,
with smart notifications that account for travel time and prep time.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from config import Config
from errors import CalendarEventError

log = logging.getLogger(__name__)


class CalendarManager:
    """
    Wraps the Google Calendar API v3.

    Usage:
        calendar = CalendarManager()
        result = calendar.create_smart_event(parsed_event, travel_info, source_email_id="abc123")
    """

    SOURCE_EMAIL_PROPERTY = "smartCalendarEmailId"
    LEAVE_ALERT_AT_PROPERTY = "smartCalendarLeaveAlertAt"

    def __init__(self) -> None:
        from google_auth import get_google_service

        self.service = get_google_service("calendar", "v3")

    def create_smart_event(
        self,
        parsed_event: dict,
        travel_info: dict | None = None,
        source_email_id: str | None = None,
    ) -> dict:
        """
        Create a Google Calendar event from parsed event data.

        Returns:
            {"status": "created"|"existing", "event": <google event dict>}

        Raises:
            CalendarEventError: If the event data is incomplete or the Calendar API fails.
        """
        if not parsed_event:
            raise CalendarEventError("Parsed event data is required for calendar creation.")

        try:
            start_dt = datetime.fromisoformat(
                f"{parsed_event['date']}T{parsed_event['start_time']}:00"
            )
            end_dt = datetime.fromisoformat(
                f"{parsed_event['date']}T{parsed_event['end_time']}:00"
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise CalendarEventError("Parsed event is missing a valid date or time.") from exc

        if end_dt <= start_dt:
            raise CalendarEventError("Parsed event end time must be after start time.")

        if source_email_id:
            existing = self._find_existing_event(source_email_id, start_dt)
            if existing is not None:
                return {"status": "existing", "event": existing}

        event_body: dict = {
            "summary": parsed_event["title"],
            "description": self._build_description(parsed_event, travel_info),
            "start": {
                "dateTime": start_dt.isoformat(),
                "timeZone": Config.timezone,
            },
            "end": {
                "dateTime": end_dt.isoformat(),
                "timeZone": Config.timezone,
            },
            "reminders": {
                "useDefault": False,
                "overrides": self._compute_smart_reminders(start_dt, parsed_event, travel_info),
            },
        }

        if parsed_event.get("location"):
            event_body["location"] = parsed_event["location"]

        leave_alert_at = self._compute_leave_alert_at(start_dt, parsed_event, travel_info)
        private_properties: dict[str, str] = {}
        if source_email_id:
            private_properties[self.SOURCE_EMAIL_PROPERTY] = source_email_id
        if leave_alert_at:
            private_properties[self.LEAVE_ALERT_AT_PROPERTY] = leave_alert_at
        if private_properties:
            event_body["extendedProperties"] = {"private": private_properties}

        try:
            created = (
                self.service.events()
                .insert(
                    calendarId="primary",
                    body=event_body,
                    sendUpdates="none",
                )
                .execute()
            )
        except Exception as exc:
            raise CalendarEventError("Calendar event creation failed.") from exc

        log.info("Calendar event created: %s", created.get("htmlLink"))
        return {"status": "created", "event": created}

    def list_todays_events(self) -> list[dict]:
        """
        Fetch today's calendar events for day planning and conflict detection.

        Raises:
            CalendarEventError: If the Calendar API request fails.
        """
        return self.list_events_for_day()

    def list_events_for_day(self, target_date: str | None = None) -> list[dict]:
        """
        Fetch calendar events for one local calendar day.

        Args:
            target_date: Local date in YYYY-MM-DD format. Defaults to today.

        Raises:
            CalendarEventError: If the Calendar API request fails.
        """
        tz = ZoneInfo(Config.timezone)
        if target_date:
            try:
                day = datetime.strptime(target_date, "%Y-%m-%d")
            except ValueError as exc:
                raise CalendarEventError(
                    f"Invalid target_date {target_date!r}; expected YYYY-MM-DD."
                ) from exc
            start_of_day = day.replace(tzinfo=tz)
        else:
            now = datetime.now(tz)
            start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
        end_of_day = start_of_day + timedelta(days=1)

        try:
            result = (
                self.service.events()
                .list(
                    calendarId="primary",
                    timeMin=start_of_day.isoformat(),
                    timeMax=end_of_day.isoformat(),
                    singleEvents=True,
                    orderBy="startTime",
                )
                .execute()
            )
        except Exception as exc:
            raise CalendarEventError("Failed to list today's events.") from exc

        return result.get("items", [])

    def list_events_in_window(self, start_dt: datetime, end_dt: datetime) -> list[dict]:
        """Fetch calendar events in a specific local time window."""
        try:
            result = (
                self.service.events()
                .list(
                    calendarId="primary",
                    timeMin=start_dt.isoformat(),
                    timeMax=end_dt.isoformat(),
                    singleEvents=True,
                    orderBy="startTime",
                )
                .execute()
            )
        except Exception as exc:
            raise CalendarEventError("Failed to list calendar events in the requested window.") from exc

        return result.get("items", [])

    def _find_existing_event(
        self,
        source_email_id: str,
        start_dt: datetime,
    ) -> dict | None:
        """Return an existing event created from the same email, if present."""
        tz = ZoneInfo(Config.timezone)
        window_start = start_dt.replace(tzinfo=tz) - timedelta(days=1)
        window_end = start_dt.replace(tzinfo=tz) + timedelta(days=2)

        try:
            result = (
                self.service.events()
                .list(
                    calendarId="primary",
                    privateExtendedProperty=f"{self.SOURCE_EMAIL_PROPERTY}={source_email_id}",
                    timeMin=window_start.isoformat(),
                    timeMax=window_end.isoformat(),
                    singleEvents=True,
                )
                .execute()
            )
        except Exception as exc:
            raise CalendarEventError("Failed to check for an existing calendar event.") from exc

        items = result.get("items", [])
        return items[0] if items else None

    @staticmethod
    def _build_description(parsed_event: dict, travel_info: dict | None) -> str:
        """Build the event description string from parsed data and travel info."""
        parts: list[str] = []

        if parsed_event.get("description"):
            parts.append(parsed_event["description"])

        detail_sentences: list[str] = []

        if travel_info:
            travel_minutes = int(travel_info.get("travel_minutes") or 0)
            travel_sentence: str | None = None
            if travel_minutes > 0:
                travel_type = CalendarManager._travel_type_phrase(Config.travel_mode)
                origin = (travel_info.get("origin") or "").strip()
                travel_sentence = f"{travel_minutes} min {travel_type}"
                if origin:
                    travel_sentence += f" from {origin}"
            if travel_info.get("departure_time"):
                if travel_sentence:
                    travel_sentence += f", leave by: {travel_info['departure_time']}"
                else:
                    travel_sentence = f"leave by: {travel_info['departure_time']}"
            if travel_sentence:
                detail_sentences.append(f"{travel_sentence}.")

        if parsed_event.get("organizer"):
            detail_sentences.append(f"organized by {parsed_event['organizer']}.")

        if detail_sentences:
            parts.append(" ".join(detail_sentences))

        if parsed_event.get("meeting_link"):
            parts.append(f"Meeting link: {parsed_event['meeting_link']}")

        return "\n".join(parts)

    @staticmethod
    def _travel_type_phrase(travel_mode: str) -> str:
        """Return a human phrase for the configured travel type."""
        return {
            "driving": "drive",
            "walking": "walk",
            "bicycling": "bike ride",
            "transit": "commute",
        }.get(travel_mode, "trip")

    @staticmethod
    def _event_context(parsed_event: dict) -> str:
        """Return a lowercase text blob describing the event."""
        parts = [
            parsed_event.get("title", ""),
            parsed_event.get("description", ""),
            parsed_event.get("location", ""),
        ]
        return " ".join(part for part in parts if part).lower()

    @classmethod
    def _wants_day_before_reminder(
        cls,
        start_dt: datetime,
        parsed_event: dict,
        travel_info: dict | None,
    ) -> bool:
        """
        Decide whether a 1-day reminder is actually helpful for this event.

        Short casual events like lunch should not get a day-before ping. More
        important, earlier, or logistically heavy events still should.
        """
        try:
            end_dt = datetime.fromisoformat(f"{parsed_event['date']}T{parsed_event['end_time']}:00")
        except (KeyError, TypeError, ValueError):
            return False

        duration_minutes = int((end_dt - start_dt).total_seconds() / 60)
        context = cls._event_context(parsed_event)
        travel_minutes = int((travel_info or {}).get("travel_minutes") or 0)

        casual_keywords = (
            "lunch",
            "breakfast",
            "brunch",
            "dinner",
            "coffee",
            "catch up",
            "hangout",
        )
        if any(keyword in context for keyword in casual_keywords) and duration_minutes <= 90:
            return False

        important_keywords = (
            "interview",
            "exam",
            "flight",
            "airport",
            "doctor",
            "dentist",
            "appointment",
            "orientation",
            "presentation",
            "deadline",
            "wedding",
            "conference",
        )
        if any(keyword in context for keyword in important_keywords):
            return True

        if start_dt.hour < 9:
            return True

        if travel_minutes >= 45:
            return True

        if duration_minutes >= 120:
            return True

        return False

    @staticmethod
    def _compute_smart_reminders(
        start_dt: datetime,
        parsed_event: dict,
        travel_info: dict | None,
    ) -> list[dict]:
        """
        Compute popup reminder offsets in minutes before the event start.
        """
        reminders: list[dict] = []

        if parsed_event.get("is_online"):
            reminders.append({"method": "popup", "minutes": Config.online_prep})
        else:
            travel_minutes = 0
            if travel_info and travel_info.get("travel_minutes"):
                travel_minutes = int(travel_info["travel_minutes"])

            leave_by_minutes = travel_minutes + Config.prep_time
            reminders.append({"method": "popup", "minutes": leave_by_minutes})

            if leave_by_minutes > 20:
                reminders.append({"method": "popup", "minutes": leave_by_minutes + 30})

        if CalendarManager._wants_day_before_reminder(start_dt, parsed_event, travel_info):
            reminders.append({"method": "popup", "minutes": 1440})
        return reminders[:5]

    @staticmethod
    def _compute_leave_alert_at(
        start_dt: datetime,
        parsed_event: dict,
        travel_info: dict | None,
    ) -> str | None:
        """Return the absolute local datetime when a leave-now text should fire."""
        if parsed_event.get("is_online") or not travel_info or not travel_info.get("departure_time"):
            return None

        travel_minutes = int(travel_info.get("travel_minutes") or 0)
        leave_by_minutes = travel_minutes + Config.prep_time
        if leave_by_minutes <= 0:
            return None

        local_tz = ZoneInfo(Config.timezone)
        local_start = (
            start_dt.replace(tzinfo=local_tz)
            if start_dt.tzinfo is None
            else start_dt.astimezone(local_tz)
        )
        return (local_start - timedelta(minutes=leave_by_minutes)).isoformat()
