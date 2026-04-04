"""
server.py — FastAPI web server.

Exposes HTTP endpoints for:
  - Vercel cron job execution
  - Status and health checks
  - Expo app: events, location, push token registration
"""
from __future__ import annotations

import asyncio
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
from .config import Config
from .day_planner import format_schedule, plan_day
from .errors import ConfigurationError, TravelEstimationError
from .logging_utils import setup_logging
from .pipeline import run_pipeline, send_due_leave_alerts
from .state_store import get_state_file
from .title_generation import fallback_transcript_title, generate_transcript_title
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
    yield


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


class ReverseGeocodeRequest(BaseModel):
    latitude: float
    longitude: float


class ReverseGeocodeResponse(BaseModel):
    label: str
    latitude: float
    longitude: float


# ── Helpers ───────────────────────────────────────────────────────────────────

def _ensure_pipeline_ready() -> None:
    report = Config.validation_report()
    if report["errors"]:
        raise ConfigurationError("; ".join(report["errors"]))


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
    """Return the safe, non-secret settings editable from the Expo app."""
    report = Config.validation_report()
    return {
        "settings": get_app_settings(),
        "errors": report["errors"],
        "warnings": report["warnings"],
    }


@app.put("/api/settings", response_model=AppSettingsResponse, dependencies=[Depends(_require_auth)])
async def update_settings(body: AppSettingsUpdateRequest):
    """Persist safe settings back to config.env and update runtime config."""
    try:
        settings = update_app_settings(body.settings)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    report = Config.validation_report()
    return {
        "settings": settings,
        "errors": report["errors"],
        "warnings": report["warnings"],
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
        return {"text": transcript, "summary": summary}
    except TranscriptionError as exc:
        log.warning("Transcription failed: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        log.exception("Unexpected transcription error: %s", exc)
        raise HTTPException(status_code=500, detail="Transcription failed.") from exc
    finally:
        upload_path.unlink(missing_ok=True)
