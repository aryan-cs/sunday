"""
server.py — FastAPI web server.

Exposes HTTP endpoints for:
  - Vercel cron job execution
  - Status and health checks
  - Expo app: events, location, push token registration
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import re
import tempfile
from urllib.parse import quote_plus
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from pydantic import BaseModel

from .app_settings import get_app_settings, update_app_settings
from .action_center_store import (
    append_action_center_entries_from_pipeline_results,
    get_recent_action_center_entries,
    action_center_entry_from_pipeline_result,
)
from .calendar_manager import CalendarManager
from .config import Config, PROJECT_ROOT
from .day_planner import format_schedule, plan_day
from .errors import ConfigurationError, TravelEstimationError
from .logging_utils import setup_logging
from .contacts_store import (
    resolve_contact_for_recipient,
    find_contacts_in_text,
    format_contact_context,
    load_contacts,
    save_contacts,
)
from .llm_client import get_llm_for_agent
from .main import poll_forever
from .messenger import send_imessage_to
from .pipeline import run_pipeline, send_due_leave_alerts
from .transcript_agent import (
    ExtractedCalendarEvent,
    ExtractedPrep,
    ExtractedReminder,
    ExtractedResearchItem,
    TranscriptActions,
    extract_actions,
)
from .state_store import get_state_file
from .title_generation import fallback_transcript_title, generate_transcript_title
from . import agent as _agent
from .openclaw import notify_voice_note as _openclaw_notify_voice
from .transcription import TranscriptionError, transcribe_audio_file
from .travel_estimator import TravelEstimator

setup_logging(Config.log_level)
log = logging.getLogger(__name__)

_TRAVEL_MODES = ("driving", "transit", "walking")
_TRAVEL_CACHE_TTL_SECONDS = 3600  # recompute after 1 hour or significant location change
_MEETING_LINK_RE = re.compile(
    r"https?://\S*(?:zoom\.us|meet\.google|teams\.microsoft)\S*",
    re.IGNORECASE,
)
_SERVER_POLLER_DISABLE_VALUES = {"1", "true", "yes", "on"}
_NEAR_RE = re.compile(r"\bnear\s+([a-zA-Z][a-zA-Z\s\-]{1,40})")


# ── Auth ─────────────────────────────────────────────────────────────────────

async def _require_auth(request: Request) -> None:
    """FastAPI dependency: enforce CRON_SECRET bearer token when configured."""
    secret = os.environ.get("CRON_SECRET", "")
    if secret and request.headers.get("authorization") != f"Bearer {secret}":
        raise HTTPException(status_code=401, detail="Unauthorized")


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Log startup validation so deployment issues are visible immediately."""
    del app
    report = Config.validation_report()
    for error in report["errors"]:
        log.error("CONFIG: %s", error)
    for warning in report["warnings"]:
        log.warning("CONFIG: %s", warning)
    poller_task: asyncio.Task[None] | None = None
    poller_stop_event: asyncio.Event | None = None

    if _should_start_embedded_poller():
        poller_stop_event = asyncio.Event()
        poller_task = asyncio.create_task(
            poll_forever(stop_event=poller_stop_event),
            name="sunday-embedded-poller",
        )
        log.info("Embedded local poller started inside FastAPI server.")

    try:
        yield
    finally:
        if poller_stop_event is not None:
            poller_stop_event.set()
        if poller_task is not None:
            try:
                await asyncio.wait_for(poller_task, timeout=5)
            except asyncio.TimeoutError:
                poller_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await poller_task


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Smart Calendar",
    description="Email → Google Calendar pipeline",
    version="1.0.0",
    lifespan=lifespan,
)


# ── Request / response models ─────────────────────────────────────────────────

class PlanDayRequest(BaseModel):
    tasks: list[str]


class ProcessResponse(BaseModel):
    processed: int
    results: list[dict]


class LocationUpdate(BaseModel):
    latitude: float
    longitude: float
    accuracy: float | None = None


class PushTokenRequest(BaseModel):
    token: str


class TranscriptionResponse(BaseModel):
    text: str
    summary: str
    actions: dict | None = None


class AppSettingsUpdateRequest(BaseModel):
    settings: dict[str, str | bool | int | float | None]


class AppSettingsResponse(BaseModel):
    settings: dict[str, str | bool]
    errors: list[str]
    warnings: list[str]
    metadata: dict[str, str]
    model_options: dict[str, list[str]]


class ReverseGeocodeRequest(BaseModel):
    latitude: float
    longitude: float


class ReverseGeocodeResponse(BaseModel):
    label: str
    latitude: float
    longitude: float


class GeocodeSearchRequest(BaseModel):
    query: str


class GeocodeSearchResponse(BaseModel):
    label: str
    latitude: float
    longitude: float


class ActionCenterResponse(BaseModel):
    entries: list[dict]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _ensure_pipeline_ready() -> None:
    report = Config.validation_report()
    if report["errors"]:
        raise ConfigurationError("; ".join(report["errors"]))


def _should_start_embedded_poller() -> bool:
    """Return true when the local self-hosted server should run the mail poller."""
    if os.getenv("VERCEL"):
        return False
    if os.getenv("PYTEST_CURRENT_TEST"):
        return False
    disable_value = os.getenv("DISABLE_SERVER_POLLER", "").strip().lower()
    return disable_value not in _SERVER_POLLER_DISABLE_VALUES


def _extract_meeting_link(description: str | None) -> str | None:
    if not description:
        return None
    match = _MEETING_LINK_RE.search(description)
    return match.group(0) if match else None


async def _reverse_geocode_label(latitude: float, longitude: float) -> str:
    """Return a human-readable address for coordinates, or a coords fallback."""
    fallback = f"{latitude:.6f}, {longitude:.6f}"
    if not Config.google_maps_key:
        return fallback

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                TravelEstimator.GEOCODE_URL,
                params={
                    "latlng": f"{latitude},{longitude}",
                    "key": Config.google_maps_key,
                },
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        log.warning("Reverse geocoding failed for %s: %s", fallback, exc)
        return fallback

    payload = response.json()
    results = payload.get("results")
    if not isinstance(results, list):
        return fallback

    for result in results:
        formatted = str(result.get("formatted_address") or "").strip()
        if formatted:
            return TravelEstimator._clean_formatted_address(formatted)

    return fallback


async def _geocode_search(query: str) -> tuple[str, float, float]:
    """Resolve a freeform location query to a cleaned label and coordinates."""
    cleaned_query = query.strip()
    if not cleaned_query:
        raise HTTPException(status_code=422, detail="Search query cannot be empty.")
    if not Config.google_maps_key:
        raise HTTPException(
            status_code=503,
            detail="Google Maps geocoding is not configured on the backend.",
        )

    params: dict[str, str] = {
        "address": cleaned_query,
        "key": Config.google_maps_key,
    }
    bounds = TravelEstimator._local_search_bounds()
    if bounds:
        params["bounds"] = bounds

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(TravelEstimator.GEOCODE_URL, params=params)
            response.raise_for_status()
    except httpx.HTTPError as exc:
        log.warning("Geocode search failed for %s: %s", cleaned_query, exc)
        raise HTTPException(status_code=502, detail="Failed to search for that location.") from exc

    payload = response.json()
    results = payload.get("results")
    if not isinstance(results, list) or not results:
        raise HTTPException(status_code=404, detail="No matching location was found.")

    first_result = results[0]
    geometry = first_result.get("geometry") or {}
    location = geometry.get("location") or {}
    latitude = location.get("lat")
    longitude = location.get("lng")
    if not isinstance(latitude, (int, float)) or not isinstance(longitude, (int, float)):
        raise HTTPException(status_code=502, detail="The geocoding result was missing coordinates.")

    label = TravelEstimator._clean_formatted_address(
        str(first_result.get("formatted_address") or cleaned_query)
    )
    return label, float(latitude), float(longitude)


def _resolve_target_calendar_label() -> str:
    """Return a friendly display name for the configured write calendar."""
    target_calendar_id = Config.target_calendar_id.strip() or "primary"
    if target_calendar_id == "primary":
        return "Primary"

    try:
        calendar = CalendarManager().service.calendars().get(
            calendarId=target_calendar_id,
        ).execute()
    except Exception as exc:
        log.warning("Failed to resolve target calendar label for %s: %s", target_calendar_id, exc)
        return target_calendar_id

    summary = str(calendar.get("summary") or "").strip()
    return summary or target_calendar_id


def _parse_event_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if value.endswith("Z"):
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def _find_calendar_conflict(
    existing_events: list[dict],
    event_date: str,
    start_time: str,
    end_time: str,
) -> dict | None:
    """Return the first overlapping event dict, if any."""
    tz = ZoneInfo(Config.timezone)
    new_start = datetime.strptime(f"{event_date}T{start_time}", "%Y-%m-%dT%H:%M").replace(
        tzinfo=tz
    )
    new_end = datetime.strptime(f"{event_date}T{end_time}", "%Y-%m-%dT%H:%M").replace(
        tzinfo=tz
    )

    for existing_ev in existing_events:
        ex_start = _parse_event_dt((existing_ev.get("start") or {}).get("dateTime"))
        ex_end = _parse_event_dt((existing_ev.get("end") or {}).get("dateTime"))
        if ex_start is None or ex_end is None:
            continue
        if new_start < ex_end and new_end > ex_start:
            return existing_ev
    return None


def _extract_research_links(actions: TranscriptActions) -> list[tuple[str, str]]:
    links: list[tuple[str, str]] = []
    for item in actions.research_items:
        title = str(item.title).strip()
        url = str(item.url).strip()
        if not url:
            continue
        links.append((title or "resource", url))
    return links


def _event_matches_title(existing_event: dict, candidate_title: str) -> bool:
    existing_title = str(existing_event.get("summary") or "").strip().lower()
    candidate = candidate_title.strip().lower()
    if not existing_title or not candidate:
        return False
    if existing_title == candidate:
        return True
    existing_tokens = {tok for tok in re.findall(r"[a-z0-9]+", existing_title) if len(tok) > 2}
    candidate_tokens = {tok for tok in re.findall(r"[a-z0-9]+", candidate) if len(tok) > 2}
    if not existing_tokens or not candidate_tokens:
        return False
    overlap = len(existing_tokens & candidate_tokens)
    return overlap >= max(2, min(len(existing_tokens), len(candidate_tokens)) // 2)


def _find_existing_event_for_enrichment(
    existing_events: list[dict],
    event_date: str,
    start_time: str,
    end_time: str,
    title: str,
) -> dict | None:
    overlap = _find_calendar_conflict(existing_events, event_date, start_time, end_time)
    if overlap is not None:
        return overlap
    for existing_event in existing_events:
        if _event_matches_title(existing_event, title):
            return existing_event
    return None


def _topic_matches_event(topic: str, event_title: str) -> bool:
    """Return True when prep topic text appears relevant to an event title."""
    topic_tokens = {tok for tok in re.findall(r"[a-z0-9]+", topic.lower()) if len(tok) > 2}
    title_tokens = {tok for tok in re.findall(r"[a-z0-9]+", event_title.lower()) if len(tok) > 2}
    if not topic_tokens or not title_tokens:
        return False
    return bool(topic_tokens & title_tokens)


def _build_tight_turnaround_note(
    existing_events: list[dict],
    event_date: str,
    start_time: str,
    location: str | None,
) -> str | None:
    """Detect short travel windows from the previous scheduled event."""
    current_location = (location or "").strip()
    if not current_location:
        return None

    tz = ZoneInfo(Config.timezone)
    try:
        start_dt = datetime.strptime(f"{event_date}T{start_time}", "%Y-%m-%dT%H:%M").replace(
            tzinfo=tz
        )
    except ValueError:
        return None

    latest_prev: tuple[dict, datetime] | None = None
    for existing_ev in existing_events:
        ex_end = _parse_event_dt((existing_ev.get("end") or {}).get("dateTime"))
        if ex_end is None or ex_end > start_dt:
            continue
        if ex_end.tzinfo is None:
            ex_end = ex_end.replace(tzinfo=tz)
        if latest_prev is None or ex_end > latest_prev[1]:
            latest_prev = (existing_ev, ex_end)

    if latest_prev is None:
        return None

    prev_event, prev_end = latest_prev
    prev_location = str(prev_event.get("location") or "").strip()
    if not prev_location or prev_location.lower() == current_location.lower():
        return None

    minutes_between = int((start_dt - prev_end).total_seconds() / 60)
    if minutes_between > 90:
        return None

    prev_summary = str(prev_event.get("summary") or "previous event").strip()
    return (
        f"Tight turnaround: {minutes_between} min between '{prev_summary}' at {prev_location} "
        f"and this event at {current_location}."
    )


def _build_event_notes(
    actions: TranscriptActions,
    event: ExtractedCalendarEvent,
    existing_events: list[dict] | None = None,
) -> str | None:
    """Build structured notes for the event description from extracted context."""
    lines: list[str] = []
    insight_lines = [
        f"- {insight.person}: {insight.insight}"
        for insight in actions.social_insights[:4]
    ]
    if insight_lines:
        lines.append("Smart notes:")
        lines.extend(insight_lines)

    prep_candidates = actions.preparation_items
    filtered_prep = [
        prep for prep in prep_candidates
        if _topic_matches_event(prep.topic, event.title)
    ] or prep_candidates
    prep_lines = [f"- {prep.topic}: {prep.suggestion}" for prep in filtered_prep[:4]]
    if prep_lines:
        if lines:
            lines.append("")
        lines.append("Prep:")
        lines.extend(prep_lines)

    if existing_events and event.date and event.start_time:
        turnaround = _build_tight_turnaround_note(
            existing_events=existing_events,
            event_date=event.date,
            start_time=event.start_time,
            location=event.location,
        )
        if turnaround:
            if lines:
                lines.append("")
            lines.append("Schedule check:")
            lines.append(f"- {turnaround}")

    links = _extract_research_links(actions)
    if links:
        if lines:
            lines.append("")
        lines.append("Helpful links:")
        for title, url in links[:5]:
            lines.append(f"- {title}: {url}")

    if not lines:
        return None
    return "\n".join(lines)


def _merge_description(existing: str | None, notes_block: str | None) -> str | None:
    """Append notes while avoiding duplicate blocks."""
    base = (existing or "").strip()
    notes = (notes_block or "").strip()
    if not notes:
        return base or None
    if notes in base:
        return base
    if not base:
        return notes
    return base + "\n\n" + notes


def _reminder_to_calendar_event(reminder: ExtractedReminder, default_date: str) -> dict:
    """
    Convert a transcript reminder into a concrete calendar event.

    Google Calendar API reminders are attached to events, so we materialize each
    reminder as a short "Reminder" event.
    """
    event_date = reminder.deadline or default_date
    priority = str(reminder.priority or "medium").lower()
    title = f"Reminder: {reminder.task.strip()}"
    description = "Auto-created from voice reminder."
    if priority in {"high", "medium", "low"}:
        description += f" Priority: {priority}."
    if reminder.deadline:
        description += f" Requested by {reminder.deadline}."
    return {
        "title": title,
        "date": event_date,
        "start_time": "09:00",
        "end_time": "09:30",
        "is_online": True,
        "description": description,
    }


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

    weekday_index = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}
    configured_days = {
        weekday_index[day.lower()]
        for day in Config.work_days
        if day.lower() in weekday_index
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


def _default_origin_for_event(start_dt: datetime) -> tuple[str | None, str | None, str | None]:
    """Choose between configured work/home defaults for a target event."""
    if _is_within_work_window(start_dt):
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


def _event_start_local_dt(event_date: str | None, start_time: str | None) -> datetime | None:
    """Parse event date/time into a timezone-aware local datetime."""
    if not event_date or not start_time:
        return None
    try:
        parsed = datetime.strptime(f"{event_date}T{start_time}", "%Y-%m-%dT%H:%M")
    except ValueError:
        return None
    return parsed.replace(tzinfo=ZoneInfo(Config.timezone))


def _travel_mode_phrase(mode: str) -> str:
    return {
        "driving": "drive",
        "walking": "walk",
        "bicycling": "bike ride",
        "transit": "transit ride",
    }.get(mode, "trip")


def _build_travel_warning_note(
    event_start: datetime | None,
    travel_info: dict | None,
) -> str | None:
    """Return a concise leave-time warning based on travel estimate."""
    if event_start is None or not travel_info:
        return None

    travel_minutes = int(travel_info.get("travel_minutes") or 0)
    if travel_minutes <= 0:
        return None

    leave_by = event_start - timedelta(minutes=travel_minutes + Config.prep_time)
    now_local = datetime.now(ZoneInfo(Config.timezone))
    mode_text = _travel_mode_phrase(Config.travel_mode)

    if now_local >= leave_by:
        return (
            f"Leave now warning: this is about a {travel_minutes} min {mode_text}; "
            f"you may be late."
        )

    minutes_until_leave = int((leave_by - now_local).total_seconds() / 60)
    if minutes_until_leave <= 20:
        return (
            f"Leave soon: about {minutes_until_leave} min until leave time for a "
            f"{travel_minutes} min {mode_text}."
        )

    if travel_minutes >= 45:
        return f"Plan extra buffer: about {travel_minutes} min {mode_text}."

    return None


def _display_model_name(model_path: str) -> str:
    path = Path(model_path)
    return path.stem if path.is_file() else path.name


def _has_restaurant_search_intent(transcript: str) -> bool:
    text = transcript.lower()
    return (
        ("restaurant" in text or "thai place" in text or "thai restaurant" in text)
        and ("find" in text or "highly rated" in text or "good" in text)
    )


def _extract_area_hint(transcript: str) -> str | None:
    match = _NEAR_RE.search(transcript)
    if not match:
        return None
    area = match.group(1).strip(" .,!?:;")
    area = re.sub(r"\b(tonight|today|tomorrow|now)\b$", "", area, flags=re.IGNORECASE).strip()
    return area if area else None


def _maps_place_url(place_id: str | None, fallback_query: str) -> str:
    if place_id:
        return f"https://www.google.com/maps/place/?q=place_id:{place_id}"
    return f"https://www.google.com/maps/search/?api=1&query={quote_plus(fallback_query)}"


async def _search_restaurant_recommendations(
    transcript: str,
    area_hint: str | None,
    cuisine_hint: str = "thai",
) -> list[dict]:
    """Use Google Places text search to return ranked restaurant candidates with links."""
    if not Config.google_maps_key:
        return []

    area = (area_hint or "").strip()
    if not area:
        area = "West Lafayette, IN"

    try:
        _, lat, lng = await _geocode_search(area)
        location = f"{lat},{lng}"
    except Exception:
        location = None

    query = f"highly rated allergy friendly {cuisine_hint} restaurant near {area}"
    params: dict[str, str | int] = {
        "query": query,
        "key": Config.google_maps_key,
    }
    if location:
        params["location"] = location
        params["radius"] = 15000

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(TravelEstimator.PLACES_TEXTSEARCH_URL, params=params)
            response.raise_for_status()
    except Exception as exc:
        log.warning("Restaurant recommendation search failed: %s", exc)
        return []

    payload = response.json()
    if payload.get("status") != "OK":
        return []

    candidates: list[dict] = []
    for place in payload.get("results", [])[:5]:
        name = str(place.get("name") or "").strip()
        address = str(place.get("formatted_address") or "").strip()
        if not name:
            continue
        rating = place.get("rating")
        total = place.get("user_ratings_total")
        place_id = str(place.get("place_id") or "").strip() or None
        map_url = _maps_place_url(place_id, f"{name} {address}".strip())
        snippet_parts = [f"{name}", address]
        if isinstance(rating, (int, float)):
            snippet_parts.append(f"rating {rating}")
        if isinstance(total, int):
            snippet_parts.append(f"{total} reviews")
        candidates.append(
            {
                "title": name,
                "location": f"{name} ({address})" if address else name,
                "url": map_url,
                "snippet": " · ".join(part for part in snippet_parts if part),
                "source": "web",
            }
        )
    return candidates


def _discover_transcription_models() -> list[str]:
    names: set[str] = set()
    roots = {
        PROJECT_ROOT / "models" / "transcription",
        PROJECT_ROOT / "models" / "audio",
        Path(Config.transcription_model_path).parent,
    }

    for root in roots:
        if not root.exists() or not root.is_dir():
            continue
        for candidate in root.rglob("*.bin"):
            if candidate.is_file():
                names.add(candidate.stem)

    names.add(_display_model_name(Config.transcription_model_path))
    return sorted(names, key=str.lower)


def _discover_summarization_models() -> list[str]:
    names: set[str] = set()
    configured_path = Path(Config.transcript_title_model_path)
    roots = {
        PROJECT_ROOT / "models" / "text",
        configured_path if configured_path.is_dir() else configured_path.parent,
    }

    for root in roots:
        if not root.exists() or not root.is_dir():
            continue
        for gguf_file in root.rglob("*.gguf"):
            if gguf_file.is_file():
                names.add(gguf_file.stem)
        for config_file in root.rglob("config.json"):
            parent = config_file.parent
            has_weights = any(parent.glob("*.safetensors")) or any(parent.glob("pytorch_model*.bin"))
            if parent.is_dir() and has_weights:
                names.add(config_file.parent.name)

    configured_name = _display_model_name(Config.transcript_title_model_path)
    configured_dir = configured_path if configured_path.is_dir() else configured_path.parent
    if (
        configured_path.suffix == ".gguf"
        and configured_path.exists()
    ) or (
        configured_dir.exists()
        and (
            any(configured_dir.glob("*.safetensors")) or any(configured_dir.glob("pytorch_model*.bin"))
        )
    ):
        names.add(configured_name)
    return sorted(names, key=str.lower)


def _settings_model_options() -> dict[str, list[str]]:
    return {
        "transcription": _discover_transcription_models(),
        "summarization": _discover_summarization_models(),
    }


def _map_calendar_event(item: dict) -> dict:
    """Map a Google Calendar event dict to the shape the app expects."""
    private = (item.get("extendedProperties") or {}).get("private") or {}
    leave_by_iso = (private.get(CalendarManager.LEAVE_ALERT_AT_PROPERTY) or "").strip() or None
    display_location = private.get(CalendarManager.DISPLAY_LOCATION_PROPERTY) or item.get("location")

    travel_minutes: int | None = None
    if leave_by_iso:
        try:
            start_raw = (item.get("start") or {}).get("dateTime", "")
            start_dt = datetime.fromisoformat(start_raw.replace("Z", "+00:00"))
            leave_dt = datetime.fromisoformat(leave_by_iso.replace("Z", "+00:00"))
            travel_minutes = max(0, round((start_dt - leave_dt).total_seconds() / 60) - Config.prep_time)
        except (ValueError, TypeError):
            pass

    return {
        "id": item.get("id", ""),
        "title": item.get("summary") or "Untitled",
        "location": display_location,
        "start_iso": (item.get("start") or {}).get("dateTime", ""),
        "end_iso": (item.get("end") or {}).get("dateTime", ""),
        "travel_minutes": travel_minutes,
        "travel_mode": Config.travel_mode,
        "leave_by_iso": leave_by_iso,
        "is_online": not bool(item.get("location")),
        "meeting_link": _extract_meeting_link(item.get("description")),
    }


async def _save_upload_to_temp(upload: UploadFile) -> Path:
    """Persist an uploaded recording to a temp file for local transcription."""
    suffix = Path(upload.filename or "").suffix or ".m4a"
    temp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix, prefix="sunday-upload-")
    try:
        content = await upload.read()
        temp.write(content)
    finally:
        temp.close()
        await upload.close()
    return Path(temp.name)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    """Health check with readiness info."""
    report = Config.validation_report()
    return {
        "status": "ok" if not report["errors"] else "degraded",
        "ready": not report["errors"],
        "llm_provider": Config.active_llm,
        "errors": report["errors"],
        "warnings": report["warnings"],
    }


@app.get("/api/status")
async def status():
    """Return current configuration status without exposing secrets."""
    report = Config.validation_report()
    return {
        "ready": not report["errors"],
        "llm_provider": Config.active_llm,
        "llm_model": Config.llm_providers.get(Config.active_llm, {}).get("model"),
        "telegram_configured": bool(Config.telegram_token and Config.telegram_chat_id),
        "imessage_enabled": Config.imessage_enabled,
        "maps_configured": bool(Config.google_maps_key),
        "expo_push_enabled": Config.expo_push_enabled,
        "errors": report["errors"],
        "warnings": report["warnings"],
    }


@app.get("/api/settings", response_model=AppSettingsResponse, dependencies=[Depends(_require_auth)])
async def get_settings():
    """Return the settings editable from the Expo app."""
    report = Config.validation_report()
    return {
        "settings": get_app_settings(),
        "errors": report["errors"],
        "warnings": report["warnings"],
        "metadata": {
            "target_calendar_label": _resolve_target_calendar_label(),
            "transcription_model_name": _display_model_name(Config.transcription_model_path),
            "summarization_model_name": _display_model_name(Config.transcript_title_model_path),
        },
        "model_options": _settings_model_options(),
    }


@app.put("/api/settings", response_model=AppSettingsResponse, dependencies=[Depends(_require_auth)])
async def update_settings(body: AppSettingsUpdateRequest):
    """Persist app-edited settings back to config.env and update runtime config."""
    try:
        settings = update_app_settings(body.settings)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    report = Config.validation_report()
    return {
        "settings": settings,
        "errors": report["errors"],
        "warnings": report["warnings"],
        "metadata": {
            "target_calendar_label": _resolve_target_calendar_label(),
            "transcription_model_name": _display_model_name(Config.transcription_model_path),
            "summarization_model_name": _display_model_name(Config.transcript_title_model_path),
        },
        "model_options": _settings_model_options(),
    }


@app.post(
    "/api/settings/reverse-geocode",
    response_model=ReverseGeocodeResponse,
    dependencies=[Depends(_require_auth)],
)
async def reverse_geocode_settings_location(body: ReverseGeocodeRequest):
    """Resolve a picked map point into the saved location label for settings."""
    label = await _reverse_geocode_label(body.latitude, body.longitude)
    return {
        "label": label,
        "latitude": body.latitude,
        "longitude": body.longitude,
    }


@app.post(
    "/api/settings/geocode",
    response_model=GeocodeSearchResponse,
    dependencies=[Depends(_require_auth)],
)
async def geocode_settings_location(body: GeocodeSearchRequest):
    """Resolve a typed location query into map coordinates and a saved label."""
    label, latitude, longitude = await _geocode_search(body.query)
    return {
        "label": label,
        "latitude": latitude,
        "longitude": longitude,
    }


@app.api_route("/api/process", methods=["GET", "POST"], response_model=ProcessResponse,
               dependencies=[Depends(_require_auth)])
async def process_emails():
    """Run one full pipeline pass."""
    try:
        _ensure_pipeline_ready()
        results = await run_pipeline()
        append_action_center_entries_from_pipeline_results(results)
        leave_alerts = await send_due_leave_alerts()
        if leave_alerts:
            failures = sum(1 for r in leave_alerts if "error" in r)
            log.info(
                "Handled %d leave alert(s) via API (%d succeeded, %d failed)",
                len(leave_alerts),
                len(leave_alerts) - failures,
                failures,
            )
        return {"processed": len(results), "results": results}
    except ConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        log.exception("Pipeline error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/action-center", response_model=ActionCenterResponse, dependencies=[Depends(_require_auth)])
async def get_action_center_entries(limit: int = 100):
    """Return recent Action Center entries generated from backend automations."""
    return {"entries": get_recent_action_center_entries(limit)}


@app.post("/api/plan-day", dependencies=[Depends(_require_auth)])
async def plan_day_endpoint(body: PlanDayRequest):
    """Given a list of tasks/errands, return an optimized day schedule."""
    try:
        calendar = CalendarManager()
        existing = calendar.list_todays_events()
        plan = await plan_day(body.tasks, existing)
        return {"schedule": plan.get("schedule", []), "formatted": format_schedule(plan)}
    except Exception as exc:
        log.exception("Day planner error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def _get_app_origin() -> tuple[str | None, float | None, float | None]:
    """Read the most recent GPS fix posted by the Expo app."""
    path = get_state_file("app_location.json")
    if not path.exists():
        return None, None, None
    try:
        data = json.loads(path.read_text())
        return f"{data['latitude']},{data['longitude']}", data["latitude"], data["longitude"]
    except (KeyError, OSError, json.JSONDecodeError):
        return None, None, None


def _travel_cache_key(event_id: str, lat: float, lng: float) -> str:
    """Cache key quantized to ~1 km so minor GPS jitter doesn't bust the cache."""
    return f"{event_id}:{round(lat, 2)}:{round(lng, 2)}"


def _load_travel_cache() -> dict:
    path = get_state_file("travel_cache.json")
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return {}


def _save_travel_cache(cache: dict) -> None:
    path = get_state_file("travel_cache.json")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cache))


def _action_center_entry_from_pipeline_result(result: dict) -> dict | None:
    return action_center_entry_from_pipeline_result(result)


@app.get("/api/events", dependencies=[Depends(_require_auth)])
async def get_events():
    """Return upcoming calendar events (next 48h) with multi-mode travel times."""
    try:
        calendar = CalendarManager()
        now = datetime.now(timezone.utc)
        items = calendar.list_events_in_window(now, now + timedelta(hours=48))

        seen: set[str] = set()
        unique = [i for i in items if i.get("id") not in seen and not seen.add(i.get("id", ""))]

        origin, lat, lng = _get_app_origin()
        cache = _load_travel_cache()
        cache_dirty = False
        travel = TravelEstimator() if (origin and Config.google_maps_key) else None

        results = []
        for item in unique:
            mapped = _map_calendar_event(item)
            location = item.get("location")

            if travel and origin and lat is not None and lng is not None and location:
                cache_key = _travel_cache_key(item.get("id", ""), lat, lng)
                cached = cache.get(cache_key)

                # Use cache if fresh
                if cached:
                    try:
                        age = (datetime.now(timezone.utc) - datetime.fromisoformat(cached["computed_at"])).total_seconds()
                        if age < _TRAVEL_CACHE_TTL_SECONDS:
                            mapped["travel"] = cached["travel"]
                            results.append(mapped)
                            continue
                    except (KeyError, ValueError):
                        pass

                # Compute all three modes
                start_iso = mapped.get("start_iso", "")
                multi: dict[str, dict | None] = {}
                for travel_mode in _TRAVEL_MODES:
                    try:
                        info = await travel.estimate(
                            destination=location,
                            departure_time=start_iso or None,
                            origin=origin,
                            mode=travel_mode,
                        )
                        multi[travel_mode] = {
                            "minutes": info["travel_minutes"],
                            "text": info["travel_text"],
                        }
                    except (ConfigurationError, TravelEstimationError):
                        multi[travel_mode] = None

                mapped["travel"] = multi
                cache[cache_key] = {"travel": multi, "computed_at": datetime.now(timezone.utc).isoformat()}
                cache_dirty = True
            else:
                mapped["travel"] = None

            results.append(mapped)

        if cache_dirty:
            _save_travel_cache(cache)

        return {"events": results}
    except Exception as exc:
        log.exception("Events fetch error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/location", dependencies=[Depends(_require_auth)])
async def update_location(body: LocationUpdate):
    """Receive a GPS update from the Expo app."""
    path = get_state_file("app_location.json")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({
        "latitude": body.latitude,
        "longitude": body.longitude,
        "accuracy": body.accuracy,
        "received_at": datetime.now(timezone.utc).isoformat(),
    }))
    log.info("App location updated: %.5f, %.5f", body.latitude, body.longitude)
    return {"ok": True}


class ContactsUpdateRequest(BaseModel):
    contacts: list[dict]


@app.get("/api/contacts", dependencies=[Depends(_require_auth)])
async def get_contacts_endpoint():
    """Return stored contact profiles."""
    return {"contacts": load_contacts()}


@app.put("/api/contacts", dependencies=[Depends(_require_auth)])
async def update_contacts_endpoint(body: ContactsUpdateRequest):
    """Replace the contacts store (called by the app on startup / change)."""
    save_contacts(body.contacts)
    return {"ok": True, "count": len(body.contacts)}


@app.post("/api/register-push-token", dependencies=[Depends(_require_auth)])
async def register_push_token(body: PushTokenRequest):
    """Register an Expo push token for leave alert delivery."""
    path = get_state_file("push_tokens.json")
    path.parent.mkdir(parents=True, exist_ok=True)

    tokens: list[str] = []
    if path.exists():
        try:
            tokens = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            tokens = []

    if body.token not in tokens:
        tokens.append(body.token)
        path.write_text(json.dumps(tokens))
        log.info("Push token registered")

    return {"ok": True}


@app.post("/api/transcribe", response_model=TranscriptionResponse, dependencies=[Depends(_require_auth)])
async def transcribe_recording(file: UploadFile = File(...)):
    """Receive an audio recording from the app and transcribe it on the Mac."""
    log.info("Received recording upload: %s", file.filename or "recording")
    upload_path = await _save_upload_to_temp(file)
    try:
        transcript = await asyncio.to_thread(transcribe_audio_file, upload_path)
        try:
            summary = await asyncio.wait_for(
                asyncio.to_thread(generate_transcript_title, transcript),
                timeout=8.0,
            )
        except asyncio.TimeoutError:
            summary = fallback_transcript_title(transcript)
            log.warning("Transcript title generation timed out; using fallback title.")
        log.info("Transcribed recording: %s", transcript)
        log.info("Transcript title: %s", summary)

        # ── Action extraction (non-blocking) ──────────────────────────────────
        actions_dict: dict | None = None
        try:
            agent_llm = get_llm_for_agent(Config.connected_agent)
            today = datetime.now().date().isoformat()

            # Inject contact context for anyone named in the transcript
            contacts = load_contacts()
            matched = find_contacts_in_text(transcript, contacts)
            contact_ctx = format_contact_context(matched) if matched else None
            if contact_ctx:
                log.info("Injecting context for %d contact(s): %s",
                         len(matched), [c.get("name") for c in matched])

            actions: TranscriptActions = await asyncio.wait_for(
                extract_actions(transcript, today=today, llm=agent_llm,
                                contact_context=contact_ctx),
                timeout=15.0,
            )

            # Deterministic place search for restaurant requests.
            if _has_restaurant_search_intent(transcript):
                area_hint = _extract_area_hint(transcript)
                suggestions = await _search_restaurant_recommendations(
                    transcript=transcript,
                    area_hint=area_hint,
                    cuisine_hint="thai" if "thai" in transcript.lower() else "restaurant",
                )
                if suggestions:
                    for suggestion in suggestions[:3]:
                        actions.research_items.append(
                            ExtractedResearchItem(
                                title=suggestion["title"],
                                url=suggestion["url"],
                                snippet=suggestion.get("snippet"),
                                source="web",
                            )
                        )
                    for ev in actions.calendar_events:
                        if not ev.location:
                            ev.location = suggestions[0]["location"]
                            if not ev.description:
                                ev.description = (
                                    f"Suggested spot: {suggestions[0]['title']} · "
                                    f"{suggestions[0]['url']}"
                                )
                            break

            # Time fallback for common implicit timing language.
            lower_transcript = transcript.lower()
            for ev in actions.calendar_events:
                if ev.start_time:
                    continue
                if "tonight" in lower_transcript:
                    ev.start_time = "19:00"
                elif "this evening" in lower_transcript:
                    ev.start_time = "19:00"
                if ev.start_time and not ev.end_time:
                    ev.end_time = "20:00"

            cal: CalendarManager | None = None
            if actions.calendar_events or actions.reminders:
                try:
                    cal = CalendarManager()
                except Exception as cal_init_exc:
                    log.warning("CalendarManager init failed: %s", cal_init_exc)

            if cal and actions.calendar_events:
                travel_estimator = TravelEstimator() if Config.google_maps_key else None
                for ev in actions.calendar_events:
                    if not (ev.title and ev.date and ev.start_time):
                        continue

                    end_time = ev.end_time
                    if not end_time:
                        try:
                            start = datetime.strptime(ev.start_time, "%H:%M")
                            end_time = (start + timedelta(hours=1)).strftime("%H:%M")
                        except ValueError:
                            end_time = ev.start_time

                    existing_for_day: list[dict] = []
                    if ev.date:
                        try:
                            existing_for_day = cal.list_events_for_day(ev.date)
                        except Exception as chk_exc:
                            log.warning("Conflict context fetch failed for '%s': %s", ev.title, chk_exc)

                    travel_info: dict | None = None
                    if (
                        travel_estimator
                        and not bool(ev.is_online)
                        and ev.location
                        and ev.date
                        and ev.start_time
                    ):
                        event_start = _event_start_local_dt(ev.date, ev.start_time)
                        origin_for_maps, origin_label, origin_source = (None, None, None)
                        app_origin, app_lat, app_lng = _get_app_origin()
                        if app_origin and app_lat is not None and app_lng is not None:
                            origin_for_maps = app_origin
                            origin_label = app_origin
                            origin_source = "app_gps"
                        elif event_start:
                            origin_for_maps, origin_label, origin_source = _default_origin_for_event(
                                event_start
                            )

                        routing_destination = ev.location
                        try:
                            resolved = await travel_estimator.resolve_destination(
                                ev.location,
                                context_text=transcript[:3000],
                                origin_bias=origin_for_maps,
                                origin_context=origin_label,
                            )
                            ev.location = resolved["display_location"]
                            routing_destination = resolved["routing_destination"]
                        except Exception as resolve_exc:
                            log.warning(
                                "Destination resolution unavailable for '%s': %s",
                                ev.title,
                                resolve_exc,
                            )

                        try:
                            departure = f"{ev.date}T{ev.start_time}:00"
                            travel_info = await travel_estimator.estimate(
                                destination=routing_destination,
                                departure_time=departure,
                                origin=origin_for_maps,
                                origin_label=origin_label,
                                origin_source=origin_source,
                                mode=Config.travel_mode,
                            )
                            travel_warning = _build_travel_warning_note(event_start, travel_info)
                            if travel_warning:
                                actions.preparation_items.append(
                                    ExtractedPrep(
                                        topic=f"Travel for {ev.title}",
                                        suggestion=travel_warning,
                                    )
                                )
                        except Exception as travel_exc:
                            log.warning("Travel estimate unavailable for '%s': %s", ev.title, travel_exc)

                    notes_block = _build_event_notes(actions, ev, existing_for_day)
                    ev.description = _merge_description(ev.description, notes_block)

                    if existing_for_day:
                        try:
                            matched_event = _find_existing_event_for_enrichment(
                                existing_events=existing_for_day,
                                event_date=ev.date,
                                start_time=ev.start_time,
                                end_time=end_time,
                                title=ev.title,
                            )
                            if matched_event:
                                ev.conflict = True
                                ev.conflict_with = str(
                                    matched_event.get("summary", "another event")
                                )
                                log.info(
                                    "Conflict detected: '%s' overlaps '%s'",
                                    ev.title,
                                    ev.conflict_with,
                                )
                                if notes_block and matched_event.get("id"):
                                    try:
                                        existing_description = str(
                                            matched_event.get("description") or ""
                                        )
                                        patched_description = _merge_description(
                                            existing_description,
                                            notes_block,
                                        )
                                        if patched_description and patched_description != existing_description:
                                            cal.service.events().patch(
                                                calendarId=str(
                                                    matched_event.get("calendarId")
                                                    or Config.target_calendar_id
                                                ),
                                                eventId=str(matched_event["id"]),
                                                body={"description": patched_description},
                                                sendUpdates="none",
                                            ).execute()
                                            log.info(
                                                "Updated existing event with contextual notes: %s",
                                                matched_event.get("id"),
                                            )
                                    except Exception as patch_exc:
                                        log.warning(
                                            "Failed to enrich existing event %s: %s",
                                            matched_event.get("id"),
                                            patch_exc,
                                        )
                                continue
                        except Exception as chk_exc:
                            log.warning("Conflict check failed: %s", chk_exc)

                    event_dict = ev.model_dump(exclude={"executed", "conflict", "conflict_with"})
                    event_dict["end_time"] = end_time
                    if ev.location:
                        event_dict["location"] = ev.location
                    try:
                        cal.create_smart_event(event_dict, travel_info=travel_info)
                        ev.executed = True
                        log.info("Created calendar event: %s", ev.title)
                    except Exception as cal_exc:
                        log.warning("Calendar write failed for '%s': %s", ev.title, cal_exc)

            if cal and actions.reminders:
                reminder_default_date = datetime.now(ZoneInfo(Config.timezone)).date().isoformat()
                for reminder in actions.reminders:
                    if not reminder.task.strip():
                        continue
                    reminder_event = _reminder_to_calendar_event(reminder, reminder_default_date)
                    try:
                        cal.create_smart_event(reminder_event, travel_info=None)
                        reminder.executed = True
                        log.info("Created calendar reminder event: %s", reminder.task)
                    except Exception as reminder_exc:
                        log.warning(
                            "Reminder calendar write failed for '%s': %s",
                            reminder.task,
                            reminder_exc,
                        )

            if actions.messages_to_send:
                for msg in actions.messages_to_send:
                    contact = resolve_contact_for_recipient(msg.recipient_name, contacts)
                    phone = str((contact or {}).get("phone", "")).strip() or None
                    if phone:
                        msg.phone = phone
                        try:
                            await send_imessage_to(phone, msg.message)
                            msg.executed = True
                            log.info("iMessage sent to %s (%s)", msg.recipient_name, phone)
                        except Exception as im_exc:
                            log.warning("iMessage to %s failed: %s", msg.recipient_name, im_exc)
                    else:
                        log.warning("No phone number for '%s'; message not sent", msg.recipient_name)

            actions_dict = actions.model_dump()
        except asyncio.TimeoutError:
            log.warning("Action extraction timed out; returning transcript without actions.")
        except Exception as agent_exc:
            log.warning("Action extraction failed: %s", agent_exc)

        return {"text": transcript, "summary": summary, "actions": actions_dict}
    except TranscriptionError as exc:
        log.warning("Transcription failed: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        log.exception("Unexpected transcription error: %s", exc)
        raise HTTPException(status_code=500, detail="Transcription failed.") from exc
    finally:
        upload_path.unlink(missing_ok=True)
