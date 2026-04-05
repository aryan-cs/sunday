"""
pipeline.py — Core pipeline logic shared by main.py and server.py.

Encapsulates one full pass: fetch emails → LLM parse → calendar → notify.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from .calendar_manager import CalendarManager
from .config import Config
from .email_parser import enrich_event_details, get_calendar_readiness_issues, parse_email, summarise_parsed
from .errors import ConfigurationError, TravelEstimationError
from .gmail_watcher import GmailWatcher
from .messenger import format_leave_alert, send_summary, send_text_message
from .state_store import get_state_file
from .travel_estimator import TravelEstimator

log = logging.getLogger(__name__)

_gmail: GmailWatcher | None = None
_calendar: CalendarManager | None = None
_travel: TravelEstimator | None = None
_CALENDAR_ORIGIN_LOOKBACK = timedelta(hours=6)
_LEAVE_ALERT_LOOKAHEAD = timedelta(days=1)
_LEAVE_ALERT_STATE_FILE = "sent_leave_alerts.json"
_WEEKDAY_INDEX = {
    "mon": 0,
    "tue": 1,
    "wed": 2,
    "thu": 3,
    "fri": 4,
    "sat": 5,
    "sun": 6,
}


def _leave_alert_state_path():
    """Return the persistent state path for sent leave alerts."""
    return get_state_file(_LEAVE_ALERT_STATE_FILE)


def _load_sent_leave_alerts() -> dict[str, str]:
    """Load previously sent leave-alert keys from disk."""
    path = _leave_alert_state_path()
    if not path.exists():
        return {}

    try:
        payload = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return {}

    sent = payload.get("sent", {})
    if not isinstance(sent, dict):
        return {}
    return {str(key): str(value) for key, value in sent.items()}


def _save_sent_leave_alerts(sent: dict[str, str]) -> None:
    """Persist sent leave-alert keys to disk."""
    path = _leave_alert_state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"sent": sent}, indent=2, sort_keys=True))


def _prune_sent_leave_alerts(sent: dict[str, str], now: datetime) -> dict[str, str]:
    """Drop stale sent-alert records so the state file stays small."""
    cutoff = now - timedelta(days=7)
    pruned: dict[str, str] = {}

    for key, sent_at in sent.items():
        try:
            parsed = datetime.fromisoformat(sent_at.replace("Z", "+00:00"))
        except ValueError:
            continue

        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=ZoneInfo(Config.timezone))
        else:
            parsed = parsed.astimezone(ZoneInfo(Config.timezone))

        if parsed >= cutoff:
            pruned[key] = sent_at

    return pruned


def _leave_alert_at_from_event(event_item: dict) -> datetime | None:
    """Read the stored leave-alert datetime from Calendar extended properties."""
    raw = (
        (((event_item.get("extendedProperties") or {}).get("private") or {}).get(
            CalendarManager.LEAVE_ALERT_AT_PROPERTY
        ))
        or ""
    ).strip()
    if not raw:
        return None

    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None

    tz = ZoneInfo(Config.timezone)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=tz)
    return parsed.astimezone(tz)


def _leave_alert_key(event_item: dict) -> str | None:
    """Build a stable deduplication key for a leave alert."""
    event_id = (event_item.get("id") or "").strip()
    raw_leave_at = (
        (((event_item.get("extendedProperties") or {}).get("private") or {}).get(
            CalendarManager.LEAVE_ALERT_AT_PROPERTY
        ))
        or ""
    ).strip()
    if not event_id or not raw_leave_at:
        return None
    return f"{event_id}:{raw_leave_at}"


def _build_gmail_thread_link(email_data: dict) -> str | None:
    """Return a Gmail web link for the source email thread when possible."""
    thread_id = (email_data.get("thread_id") or "").strip()
    if thread_id:
        return f"https://mail.google.com/mail/u/0/#all/{thread_id}"

    message_id = (email_data.get("id") or "").strip()
    if message_id:
        return f"https://mail.google.com/mail/u/0/#all/{message_id}"

    return None


def _event_start_dt(event: dict) -> datetime | None:
    """Return the target event's start as a timezone-aware datetime."""
    try:
        start_dt = datetime.fromisoformat(f"{event['date']}T{event['start_time']}:00")
    except (KeyError, TypeError, ValueError):
        return None

    return start_dt.replace(tzinfo=ZoneInfo(Config.timezone))


def _destination_context_text(parsed: dict, email_data: dict) -> str:
    """Build context that helps resolve vague place names like restaurant nicknames."""
    event = parsed.get("event") or {}
    parts = [
        parsed.get("summary", ""),
        event.get("title", ""),
        event.get("description", ""),
        " ".join(parsed.get("action_items", [])),
        email_data.get("subject", ""),
        email_data.get("body", ""),
    ]
    return " ".join(part for part in parts if part).strip()


def _replace_venue_name(text: str | None, original: str | None, canonical: str | None) -> str | None:
    """Replace an original venue string with a canonical one when it appears in text."""
    if not text or not original or not canonical:
        return text
    if original.strip().lower() == canonical.strip().lower():
        return text

    pattern = re.compile(re.escape(original.strip()), re.IGNORECASE)
    if not pattern.search(text):
        return text
    return pattern.sub(canonical.strip(), text)


def _google_event_dt(event_item: dict, edge: str) -> datetime | None:
    """Parse a Google Calendar start/end dateTime into local timezone."""
    raw = ((event_item.get(edge) or {}).get("dateTime") or "").strip()
    if not raw:
        return None

    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None

    tz = ZoneInfo(Config.timezone)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=tz)
    return parsed.astimezone(tz)


def _get_live_location() -> tuple[str | None, str | None, str | None]:
    """
    Return the freshest available iPhone GPS location.

    Checks two sources in priority order:
      1. .state/app_location.json  — written by the Expo app via POST /api/location
      2. iCloud Drive sunday-location.json — written by the iOS Shortcut fallback

    Returns (maps_origin, label, source) or (None, None, None) when unavailable/stale.
    """
    from datetime import timezone as _tz
    from pathlib import Path

    max_age = timedelta(minutes=Config.app_location_max_age_minutes)
    now_utc = datetime.now(_tz.utc)

    # Source 1: Expo app
    app_path = get_state_file("app_location.json")
    if app_path.exists():
        try:
            data = json.loads(app_path.read_text())
            received_at = datetime.fromisoformat(data["received_at"].replace("Z", "+00:00"))
            if received_at.tzinfo is None:
                received_at = received_at.replace(tzinfo=_tz.utc)
            if now_utc - received_at <= max_age:
                lat, lng = data["latitude"], data["longitude"]
                return f"{lat},{lng}", f"{lat},{lng}", "app_gps"
        except (KeyError, ValueError, OSError, json.JSONDecodeError):
            pass

    # Source 2: iCloud Drive Shortcut
    icloud_path = (
        Path.home() / "Library" / "Mobile Documents" / "com~apple~CloudDocs" / "sunday-location.json"
    )
    if icloud_path.exists():
        try:
            data = json.loads(icloud_path.read_text())
            mtime = datetime.fromtimestamp(icloud_path.stat().st_mtime, tz=_tz.utc)
            if now_utc - mtime <= max_age:
                lat, lng = data["lat"], data["lng"]
                return f"{lat},{lng}", f"{lat},{lng}", "icloud_shortcut"
        except (KeyError, ValueError, OSError, json.JSONDecodeError):
            pass

    return None, None, None


def _origin_from_address(
    address: str | None,
    lat: float | None,
    lng: float | None,
    source: str,
) -> tuple[str | None, str | None, str | None]:
    """Build a Maps origin tuple from an address and optional coordinates."""
    clean_address = (address or "").strip()
    if lat is not None and lng is not None and clean_address:
        return f"{lat},{lng}", clean_address, source
    if clean_address:
        return clean_address, clean_address, source
    return None, None, None


def _is_within_work_window(start_dt: datetime) -> bool:
    """Return true when an event start falls within the configured work schedule."""
    if not Config.default_work_location:
        return False

    configured_days = {
        _WEEKDAY_INDEX[day.lower()]
        for day in Config.work_days
        if day.lower() in _WEEKDAY_INDEX
    }
    if start_dt.weekday() not in configured_days:
        return False

    try:
        work_start = datetime.strptime(Config.workday_start_time, "%H:%M").time()
        work_end = datetime.strptime(Config.workday_end_time, "%H:%M").time()
    except ValueError:
        return False

    event_time = start_dt.timetz().replace(tzinfo=None)
    if work_start <= work_end:
        return work_start <= event_time < work_end
    return event_time >= work_start or event_time < work_end


def _default_origin_for_event(start_dt: datetime | None) -> tuple[str | None, str | None, str | None]:
    """Choose between configured work/home defaults for a target event."""
    if start_dt and _is_within_work_window(start_dt):
        work_origin = _origin_from_address(
            Config.default_work_location,
            Config.default_work_lat,
            Config.default_work_lng,
            "work",
        )
        if work_origin[0]:
            return work_origin

    home_origin = _origin_from_address(
        Config.default_home_location,
        Config.default_home_lat,
        Config.default_home_lng,
        "home",
    )
    if home_origin[0]:
        return home_origin

    return _origin_from_address(
        Config.default_work_location,
        Config.default_work_lat,
        Config.default_work_lng,
        "work",
    )


def _scheduled_origin_for_event(
    calendar: CalendarManager,
    start_dt: datetime | None,
) -> tuple[str | None, str | None, str | None]:
    """Infer origin from the latest scheduled calendar event before the target event."""
    if start_dt is None:
        return None, None, None

    events = calendar.list_events_for_day(start_dt.date().isoformat())
    best_origin: tuple[str | None, str | None, str | None] = (None, None, None)
    best_end: datetime | None = None

    for item in events:
        location = (item.get("location") or "").strip()
        if not location:
            continue

        candidate_end = _google_event_dt(item, "end")
        if candidate_end is None:
            continue

        gap = start_dt - candidate_end
        if gap.total_seconds() < 0 or gap > _CALENDAR_ORIGIN_LOOKBACK:
            continue

        if best_end is None or candidate_end > best_end:
            best_end = candidate_end
            best_origin = (location, location, "calendar_context")

    return best_origin


async def _choose_travel_origin(
    event: dict,
    calendar: CalendarManager,
    processing_notes: list[str],
) -> tuple[str | None, str | None, str | None]:
    """
    Infer the most likely travel origin for an event.

    Priority:
      1. Live iPhone GPS (Expo app or iCloud Shortcut)
      2. The latest scheduled calendar event with a location before this event
      3. Configured work location during work hours
      4. Configured home location
    """
    start_dt = _event_start_dt(event)

    live = _get_live_location()
    if live[0]:
        log.info("  → Travel origin: %s", live[2])
        return live

    try:
        scheduled_origin = _scheduled_origin_for_event(calendar, start_dt)
    except Exception as exc:
        log.warning("  → Calendar-context origin unavailable: %s", exc)
        processing_notes.append(f"Calendar-context origin unavailable: {exc}")
    else:
        if scheduled_origin[0]:
            return scheduled_origin

    return _default_origin_for_event(start_dt)


def _get_singletons() -> tuple[GmailWatcher, CalendarManager, TravelEstimator]:
    global _gmail, _calendar, _travel
    if _gmail is None:
        _gmail = GmailWatcher()
    if _calendar is None:
        _calendar = CalendarManager()
    if _travel is None:
        _travel = TravelEstimator()
    return _gmail, _calendar, _travel


async def process_single_email(
    email_data: dict,
    gmail: GmailWatcher,
    calendar: CalendarManager,
    travel: TravelEstimator,
) -> dict:
    """
    Run the full pipeline on one email and return a result summary dict.

    Processing only counts as complete once the summary is delivered and
    the Gmail message is marked as processed.
    """
    log.info("Processing: %s", email_data.get("subject", "—"))

    parsed = await parse_email(email_data)
    parsed = enrich_event_details(parsed, email_data)
    log.info("  %s", summarise_parsed(parsed))

    calendar_status = "not_applicable"
    calendar_event_link: str | None = None
    processing_notes: list[str] = []
    travel_info: dict | None = None

    if parsed.get("has_event") and parsed.get("event"):
        readiness_issues = get_calendar_readiness_issues(parsed)
        if readiness_issues:
            calendar_status = "skipped_incomplete"
            processing_notes.append(
                "Calendar event was skipped: " + "; ".join(readiness_issues)
            )
        else:
            event = parsed["event"]
            if not event.get("is_online") and event.get("location"):
                routing_destination = event["location"]
                origin_for_maps, origin_label, origin_source = await _choose_travel_origin(
                    event,
                    calendar,
                    processing_notes,
                )

                try:
                    resolved_location = await travel.resolve_destination(
                        event["location"],
                        context_text=_destination_context_text(parsed, email_data),
                        origin_bias=origin_for_maps,
                        origin_context=origin_label,
                    )
                except (ConfigurationError, TravelEstimationError) as exc:
                    log.warning("  → Exact address lookup unavailable: %s", exc)
                    processing_notes.append(f"Exact address lookup unavailable: {exc}")
                else:
                    canonical_name = resolved_location.get("canonical_name")
                    if canonical_name:
                        event["title"] = _replace_venue_name(
                            event.get("title"),
                            event["location"],
                            canonical_name,
                        )
                    event["display_location"] = resolved_location["display_location"]
                    event["calendar_location"] = resolved_location["calendar_location"]
                    event["location"] = resolved_location["display_location"]
                    routing_destination = resolved_location["routing_destination"]

                departure = f"{event['date']}T{event['start_time']}:00"
                try:
                    travel_info = await travel.estimate(
                        destination=routing_destination,
                        departure_time=departure,
                        origin=origin_for_maps,
                        origin_label=origin_label,
                        origin_source=origin_source,
                    )
                except (ConfigurationError, TravelEstimationError) as exc:
                    log.warning("  → Travel estimation unavailable: %s", exc)
                    processing_notes.append(f"Travel estimate unavailable: {exc}")
                else:
                    log.info("  → Travel: %d min", travel_info["travel_minutes"])
                    log.info(
                        "  → Travel origin: %s (%s)",
                        travel_info.get("origin", origin_label or origin_for_maps or "unknown"),
                        travel_info.get("origin_source", origin_source or "unknown"),
                    )

            calendar_result = calendar.create_smart_event(
                event,
                travel_info,
                source_email_id=email_data.get("id"),
            )
            calendar_status = calendar_result["status"]
            calendar_event_link = calendar_result["event"].get("htmlLink")
            log.info("  → Calendar status: %s", calendar_status)

    await send_summary(
        parsed_email=parsed,
        calendar_status=calendar_status,
        travel_info=travel_info,
        processing_notes=processing_notes,
        source_email_link=_build_gmail_thread_link(email_data),
    )
    log.info("  → Summary sent")

    gmail.mark_as_processed(email_data["id"])
    log.info("  → Gmail message marked as processed")

    return {
        "email_id": email_data.get("id"),
        "subject": email_data.get("subject"),
        "has_event": parsed.get("has_event"),
        "event": parsed.get("event"),
        "calendar_status": calendar_status,
        "calendar_event_link": calendar_event_link,
        "urgency": parsed.get("urgency"),
        "summary": parsed.get("summary"),
        "processing_notes": processing_notes,
    }


async def send_due_leave_alerts(
    calendar: CalendarManager | None = None,
    now: datetime | None = None,
) -> list[dict]:
    """Send once-only leave-now texts for managed events whose departure time is due."""
    tz = ZoneInfo(Config.timezone)
    now_local = now or datetime.now(tz)
    if now_local.tzinfo is None:
        now_local = now_local.replace(tzinfo=tz)
    else:
        now_local = now_local.astimezone(tz)

    active_calendar = calendar or _get_singletons()[1]

    try:
        events = active_calendar.list_events_in_window(now_local, now_local + _LEAVE_ALERT_LOOKAHEAD)
    except Exception as exc:
        log.warning("Leave-alert scan unavailable: %s", exc)
        return []

    sent_state = _prune_sent_leave_alerts(_load_sent_leave_alerts(), now_local)
    results: list[dict] = []
    state_dirty = False

    for event_item in events:
        leave_alert_at = _leave_alert_at_from_event(event_item)
        if leave_alert_at is None or leave_alert_at > now_local:
            continue

        start_dt = _google_event_dt(event_item, "start")
        if start_dt is not None and start_dt <= now_local:
            continue

        alert_key = _leave_alert_key(event_item)
        if not alert_key or alert_key in sent_state:
            continue

        try:
            await send_text_message(format_leave_alert(event_item))
        except Exception as exc:
            log.error(
                "Leave-alert delivery failed for %s: %s",
                event_item.get("summary") or event_item.get("id") or "event",
                exc,
            )
            results.append(
                {
                    "event_id": event_item.get("id"),
                    "summary": event_item.get("summary"),
                    "error": str(exc),
                }
            )
            continue

        sent_state[alert_key] = now_local.isoformat()
        state_dirty = True
        log.info("  → Leave alert sent for %s", event_item.get("summary") or event_item.get("id"))
        results.append(
            {
                "event_id": event_item.get("id"),
                "summary": event_item.get("summary"),
                "status": "sent",
            }
        )

    if state_dirty:
        _save_sent_leave_alerts(sent_state)

    return results


async def run_pipeline(max_emails: int | None = None) -> list[dict]:
    """
    Fetch new emails and run the full pipeline on each one.
    """
    gmail, calendar, travel = _get_singletons()
    email_limit = max_emails if max_emails is not None else Config.max_emails_per_cycle

    new_emails = gmail.get_new_emails(max_results=email_limit)
    if not new_emails:
        log.debug("No new emails this cycle")
        return []

    log.info("📬 %d new email(s)", len(new_emails))
    results: list[dict] = []

    for email_data in new_emails:
        try:
            results.append(await process_single_email(email_data, gmail, calendar, travel))
        except Exception as exc:
            log.error(
                "Unhandled error processing email %s: %s",
                email_data.get("id"),
                exc,
            )
            results.append(
                {
                    "email_id": email_data.get("id"),
                    "subject": email_data.get("subject"),
                    "error": str(exc),
                }
            )

    return results
