"""
location_state.py — Live location manager.

Stores the most recent GPS coordinates pushed from the user's phone
(via iOS Shortcut → POST /api/location). Falls back to the configured
default location when no live fix is available.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from config import Config
from errors import ConfigurationError
from state_store import get_state_dir, get_state_file

log = logging.getLogger(__name__)

_STATE_FILE = get_state_file("location.json")


def _load() -> dict | None:
    """Load the persisted location state from disk."""
    if not _STATE_FILE.exists():
        return None

    try:
        return json.loads(_STATE_FILE.read_text())
    except (OSError, ValueError) as exc:
        log.warning("Could not read persisted location state: %s", exc)
        return None


def _save(state: dict) -> None:
    """Persist location state to disk."""
    get_state_dir(create=True)
    _STATE_FILE.write_text(json.dumps(state, indent=2))


def update_location(lat: float, lng: float, address: str | None = None) -> dict:
    """
    Update the current location from a GPS fix.

    Called by POST /api/location (iOS Shortcut).
    """
    state = {
        "lat": lat,
        "lng": lng,
        "address": address or f"{lat:.5f},{lng:.5f}",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    _save(state)
    log.info("Location updated: %s (%.5f, %.5f)", state["address"], lat, lng)
    return state


def get_current_location() -> dict:
    """
    Return the best available location.

    Priority:
      1. Live GPS fix pushed from phone
      2. Static default from config.env
    """
    state = _load()
    if state:
        return {
            "address": state["address"],
            "lat": state["lat"],
            "lng": state["lng"],
            "source": "live",
            "updated_at": state.get("updated_at"),
        }

    if not Config.default_home_location:
        raise ConfigurationError(
            "No live location is stored and DEFAULT_HOME_LOCATION is not configured."
        )

    return {
        "address": Config.default_home_location,
        "lat": Config.default_home_lat,
        "lng": Config.default_home_lng,
        "source": "config",
        "updated_at": None,
    }


def get_origin_string() -> str:
    """
    Return the origin string suitable for passing to Google Maps API.

    Uses "lat,lng" format when we have a live GPS fix, or the configured
    address when we do not.
    """
    loc = get_current_location()
    if loc["source"] == "live":
        return f"{loc['lat']},{loc['lng']}"
    return loc["address"]
