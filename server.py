"""
server.py — FastAPI web server.

Exposes HTTP endpoints for:
  - Vercel cron job execution
  - Status and health checks
  - Expo app: events, location, push token registration
"""
from __future__ import annotations

import json
import logging
import os
import re
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel

from calendar_manager import CalendarManager
from config import Config
from day_planner import format_schedule, plan_day
from errors import ConfigurationError
from logging_utils import setup_logging
from pipeline import run_pipeline, send_due_leave_alerts
from state_store import get_state_file

setup_logging(Config.log_level)
log = logging.getLogger(__name__)

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


@app.get("/api/events", dependencies=[Depends(_require_auth)])
async def get_events():
    """Return upcoming calendar events (next 48h) for the app dashboard."""
    try:
        calendar = CalendarManager()
        now = datetime.now(timezone.utc)
        items = calendar.list_events_in_window(now, now + timedelta(hours=48))
        return {"events": [_map_calendar_event(item) for item in items]}
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
