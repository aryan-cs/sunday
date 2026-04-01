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

        if parsed_event.get("attendees"):
            event_body["attendees"] = [{"email": email} for email in parsed_event["attendees"]]

        if source_email_id:
            event_body["extendedProperties"] = {
                "private": {self.SOURCE_EMAIL_PROPERTY: source_email_id}
            }

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
        tz = ZoneInfo(Config.timezone)
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

        if parsed_event.get("meeting_link"):
            parts.append(f"Meeting link: {parsed_event['meeting_link']}")

        if travel_info:
            parts.append(
                f"Travel: {travel_info['travel_minutes']} min "
                f"({travel_info.get('travel_text', '')}) from {travel_info.get('origin', '')}"
            )
            if travel_info.get("departure_time"):
                parts.append(f"Leave by: {travel_info['departure_time']}")

        if parsed_event.get("organizer"):
            parts.append(f"Organized by: {parsed_event['organizer']}")

        return "\n".join(parts)

    @staticmethod
    def _compute_smart_reminders(
        start_dt: datetime,
        parsed_event: dict,
        travel_info: dict | None,
    ) -> list[dict]:
        """
        Compute popup reminder offsets in minutes before the event start.
        """
        del start_dt
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

        reminders.append({"method": "popup", "minutes": 1440})
        return reminders[:5]
