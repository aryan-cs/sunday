"""
server.py — FastAPI web server.

Exposes HTTP endpoints for:
  - iOS Shortcut integration
  - Vercel cron job execution
  - Status and health checks
"""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel

from calendar_manager import CalendarManager
from config import Config
from day_planner import format_schedule, plan_day
from errors import ConfigurationError
from location_state import get_current_location, update_location
from pipeline import run_pipeline

log = logging.getLogger(__name__)


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


app = FastAPI(
    title="Smart Calendar",
    description="Email → Google Calendar pipeline",
    version="1.0.0",
    lifespan=lifespan,
)


class PlanDayRequest(BaseModel):
    tasks: list[str]


class ProcessResponse(BaseModel):
    processed: int
    results: list[dict]


class LocationUpdate(BaseModel):
    lat: float
    lng: float
    address: str | None = None


def _ensure_pipeline_ready() -> None:
    report = Config.validation_report()
    if report["errors"]:
        raise ConfigurationError("; ".join(report["errors"]))


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


@app.api_route("/api/process", methods=["GET", "POST"], response_model=ProcessResponse)
async def process_emails(request: Request):
    """Run one full pipeline pass."""
    cron_secret = os.environ.get("CRON_SECRET", "")
    if cron_secret:
        auth_header = request.headers.get("authorization", "")
        if auth_header != f"Bearer {cron_secret}":
            raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        _ensure_pipeline_ready()
        results = await run_pipeline()
        return {"processed": len(results), "results": results}
    except ConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        log.exception("Pipeline error: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/plan-day")
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


@app.post("/api/location")
async def post_location(body: LocationUpdate):
    """Receive a live GPS fix from the user's phone."""
    try:
        state = update_location(body.lat, body.lng, body.address)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"status": "ok", "location": state}


@app.get("/api/location")
async def get_location():
    """Return the current location being used for travel estimates."""
    try:
        return get_current_location()
    except ConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


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
        "errors": report["errors"],
        "warnings": report["warnings"],
    }
