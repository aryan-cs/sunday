"""
travel_estimator.py — Travel time estimation via Google Maps Distance Matrix API.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta

import httpx

from config import Config
from errors import ConfigurationError, TravelEstimationError
from location_state import get_current_location, get_origin_string

log = logging.getLogger(__name__)


class TravelEstimator:
    """
    Estimate travel time from the user's current or configured location.

    Usage:
        travel = TravelEstimator()
        info = await travel.estimate(
            destination="Siebel Center 2124, Urbana, IL",
            departure_time="2025-04-03T14:00:00",
        )
    """

    BASE_URL = "https://maps.googleapis.com/maps/api/distancematrix/json"
    GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"

    @staticmethod
    def _clean_formatted_address(address: str) -> str:
        """Normalise Google's formatted addresses for friendlier user output."""
        return re.sub(r",\s*USA$", "", address.strip())

    @classmethod
    def _addresses_equivalent(cls, left: str, right: str) -> bool:
        """Return true when two location strings are effectively the same."""
        normalize = lambda value: re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()
        return normalize(left) == normalize(right)

    async def resolve_destination(self, destination: str) -> dict:
        """
        Resolve a human place name to a friendlier display string and exact address.

        Returns:
            {
                "query": original input,
                "formatted_address": exact address or None,
                "display_location": string suitable for Calendar/texts,
                "routing_destination": best destination for Maps routing,
            }
        }
        """
        if not Config.google_maps_key:
            raise ConfigurationError(
                "GOOGLE_MAPS_API_KEY is required for travel-aware reminders."
            )

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    self.GEOCODE_URL,
                    params={"address": destination, "key": Config.google_maps_key},
                )
                resp.raise_for_status()
                data = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise TravelEstimationError("Google Maps geocoding request failed.") from exc

        status = data.get("status")
        if status == "ZERO_RESULTS":
            return {
                "query": destination,
                "formatted_address": None,
                "display_location": destination,
                "routing_destination": destination,
            }
        if status != "OK":
            raise TravelEstimationError(
                f"Google Maps could not resolve destination {destination!r}: {status}."
            )

        try:
            first_result = data["results"][0]
            formatted_address = self._clean_formatted_address(first_result["formatted_address"])
        except (KeyError, IndexError, TypeError) as exc:
            raise TravelEstimationError(
                "Google Maps geocoding returned an unexpected response shape."
            ) from exc

        display_location = destination
        if formatted_address and not self._addresses_equivalent(destination, formatted_address):
            display_location = f"{destination} ({formatted_address})"
        elif formatted_address:
            display_location = formatted_address

        return {
            "query": destination,
            "formatted_address": formatted_address,
            "display_location": display_location,
            "routing_destination": formatted_address or destination,
        }

    async def estimate(
        self,
        destination: str,
        departure_time: str | None = None,
        origin: str | None = None,
    ) -> dict:
        """
        Estimate travel time from origin to destination.

        Raises:
            ConfigurationError: When Maps is not configured.
            TravelEstimationError: When Google Maps does not return usable travel data.
        """
        if not Config.google_maps_key:
            raise ConfigurationError(
                "GOOGLE_MAPS_API_KEY is required for travel-aware reminders."
            )

        _origin = origin or get_origin_string()
        if not _origin:
            raise TravelEstimationError(
                "No origin is available for travel estimation. Configure MY_DEFAULT_LOCATION "
                "or send a live location update."
            )

        loc_info = get_current_location()
        log.debug("Travel origin: %s (source: %s)", _origin, loc_info["source"])

        params: dict = {
            "origins": _origin,
            "destinations": destination,
            "mode": Config.travel_mode,
            "key": Config.google_maps_key,
        }

        if departure_time:
            try:
                departure_dt = datetime.fromisoformat(departure_time)
            except ValueError as exc:
                raise TravelEstimationError(
                    f"Invalid departure_time {departure_time!r}."
                ) from exc
            params["departure_time"] = int(departure_dt.timestamp())

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(self.BASE_URL, params=params)
                resp.raise_for_status()
                data = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise TravelEstimationError("Google Maps request failed.") from exc

        try:
            element = data["rows"][0]["elements"][0]
        except (KeyError, IndexError, TypeError) as exc:
            raise TravelEstimationError(
                "Google Maps returned an unexpected response shape."
            ) from exc

        status = element.get("status")
        if status != "OK":
            raise TravelEstimationError(
                f"Google Maps could not estimate travel for destination {destination!r}: {status}."
            )

        duration_info = element.get("duration_in_traffic") or element.get("duration")
        if not duration_info or "value" not in duration_info:
            raise TravelEstimationError("Google Maps response did not include travel duration.")

        travel_minutes = round(duration_info["value"] / 60)
        departure_str: str | None = None

        if departure_time:
            event_start = datetime.fromisoformat(departure_time)
            leave_by = event_start - timedelta(minutes=travel_minutes + Config.prep_time)
            departure_str = leave_by.strftime("%-I:%M %p")

        return {
            "travel_minutes": travel_minutes,
            "travel_text": duration_info.get("text", f"{travel_minutes} mins"),
            "distance_text": element.get("distance", {}).get("text", "unknown"),
            "origin": loc_info.get("address", _origin),
            "origin_source": loc_info["source"],
            "departure_time": departure_str,
        }
