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
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from pydantic import BaseModel

from .app_settings import get_app_settings, update_app_settings
from .calendar_manager import CalendarManager
from .config import Config, PROJECT_ROOT
from .day_planner import format_schedule, plan_day
from .errors import ConfigurationError, TravelEstimationError
from .logging_utils import setup_logging
from .main import poll_forever
from .pipeline import run_pipeline, send_due_leave_alerts
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


def _display_model_name(model_path: str) -> str:
    path = Path(model_path)
    return path.stem if path.is_file() else path.name


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


def _list_readable_calendars() -> list[dict[str, str | None]]:
    """Return readable calendars with friendly labels and Google colors when available."""
    calendar = CalendarManager()
    calendars: list[dict[str, str | None]] = []
    seen: set[str] = set()
    page_token: str | None = None

    while True:
        kwargs = {"pageToken": page_token} if page_token else {}
        result = calendar.service.calendarList().list(**kwargs).execute()

        for item in result.get("items", []):
            calendar_id = str(item.get("id") or "").strip()
            if not calendar_id or calendar_id in seen:
                continue

            seen.add(calendar_id)
            calendars.append(
                {
                    "id": calendar_id,
                    "name": str(item.get("summary") or calendar_id).strip() or calendar_id,
                    "default_color": str(item.get("backgroundColor") or "").strip() or None,
                }
            )

        page_token = result.get("nextPageToken")
        if not page_token:
            break

    target_calendar_id = Config.target_calendar_id.strip() or "primary"
    if target_calendar_id not in seen:
        calendars.append(
            {
                "id": target_calendar_id,
                "name": _resolve_target_calendar_label(),
                "default_color": None,
            }
        )

    return sorted(calendars, key=lambda calendar_item: str(calendar_item["name"]).lower())


def _map_calendar_event(
    item: dict,
    calendar_lookup: dict[str, dict[str, str | None]] | None = None,
) -> dict:
    """Map a Google Calendar event dict to the shape the app expects."""
    private = (item.get("extendedProperties") or {}).get("private") or {}
    leave_by_iso = (private.get(CalendarManager.LEAVE_ALERT_AT_PROPERTY) or "").strip() or None
    display_location = private.get(CalendarManager.DISPLAY_LOCATION_PROPERTY) or item.get("location")
    start_data = item.get("start") or {}
    end_data = item.get("end") or {}
    calendar_id = str(item.get("calendarId") or "").strip()
    calendar_meta = calendar_lookup.get(calendar_id, {}) if calendar_lookup else {}
    meeting_link = _extract_meeting_link(item.get("description")) or item.get("hangoutLink")
    is_all_day = bool(start_data.get("date") and not start_data.get("dateTime"))
    attendees = [
        {
            "name": str(attendee.get("displayName") or attendee.get("email") or "").strip(),
            "email": str(attendee.get("email") or "").strip() or None,
            "response_status": str(attendee.get("responseStatus") or "").strip() or None,
        }
        for attendee in item.get("attendees", [])
        if isinstance(attendee, dict)
        and str(attendee.get("displayName") or attendee.get("email") or "").strip()
    ]
    description = str(item.get("description") or "").strip() or None
    notes = str(private.get("smartCalendarNotes") or "").strip() or None

    travel_minutes: int | None = None
    if leave_by_iso:
        try:
            start_raw = start_data.get("dateTime", "")
            start_dt = datetime.fromisoformat(start_raw.replace("Z", "+00:00"))
            leave_dt = datetime.fromisoformat(leave_by_iso.replace("Z", "+00:00"))
            travel_minutes = max(0, round((start_dt - leave_dt).total_seconds() / 60) - Config.prep_time)
        except (ValueError, TypeError):
            pass

    return {
        "id": item.get("id", ""),
        "calendar_id": calendar_id,
        "calendar_name": calendar_meta.get("name") or calendar_id or "Calendar",
        "calendar_default_color": calendar_meta.get("default_color"),
        "title": item.get("summary") or "Untitled",
        "location": display_location,
        "start_iso": start_data.get("dateTime") or start_data.get("date") or "",
        "end_iso": end_data.get("dateTime") or end_data.get("date") or "",
        "travel_minutes": travel_minutes,
        "travel_mode": Config.travel_mode,
        "leave_by_iso": leave_by_iso,
        "is_online": bool(meeting_link),
        "is_all_day": is_all_day,
        "meeting_link": meeting_link,
        "description": description,
        "attendees": attendees,
        "notes": notes,
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
        "message_channel": Config.message_channel,
        "telegram_configured": bool(Config.telegram_token and Config.telegram_chat_id),
        "imessage_enabled": Config.imessage_enabled,
        "whatsapp_configured": bool(
            Config.whatsapp_access_token
            and Config.whatsapp_phone_number_id
            and Config.whatsapp_recipient
        ),
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


@app.get("/api/events", dependencies=[Depends(_require_auth)])
async def get_events():
    """Return upcoming calendar events (next 48h) with multi-mode travel times."""
    try:
        calendar = CalendarManager()
        now = datetime.now(timezone.utc)
        items = calendar.list_events_in_window(now, now + timedelta(hours=48))
        calendars = _list_readable_calendars()
        calendar_lookup = {
            str(calendar_item["id"]): calendar_item
            for calendar_item in calendars
        }

        seen: set[str] = set()
        unique: list[dict] = []
        for item in items:
            dedupe_key = f"{item.get('calendarId', '')}:{item.get('id', '')}"
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            unique.append(item)

        origin, lat, lng = _get_app_origin()
        cache = _load_travel_cache()
        cache_dirty = False
        travel = TravelEstimator() if (origin and Config.google_maps_key) else None

        results = []
        for item in unique:
            mapped = _map_calendar_event(item, calendar_lookup)
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

        return {
            "events": results,
            "calendars": calendars,
        }
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
        if Config.agent_mode in ("openclaw", "both"):
            await _openclaw_notify_voice(transcript, summary)
        if Config.agent_mode in ("builtin", "both"):
            await _agent.notify_voice_note(transcript, summary)
        return {"text": transcript, "summary": summary}
    except TranscriptionError as exc:
        log.warning("Transcription failed: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        log.exception("Unexpected transcription error: %s", exc)
        raise HTTPException(status_code=500, detail="Transcription failed.") from exc
    finally:
        upload_path.unlink(missing_ok=True)
