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
    _LOCAL_BIAS_PADDING = 0.15

    @staticmethod
    def _default_origin() -> tuple[str | None, dict]:
        """Return the best configured fallback origin for standalone travel estimates."""
        if Config.default_home_location:
            origin = (
                f"{Config.default_home_lat},{Config.default_home_lng}"
                if Config.default_home_lat is not None and Config.default_home_lng is not None
                else Config.default_home_location
            )
            return origin, {"address": Config.default_home_location, "source": "home"}

        if Config.default_work_location:
            origin = (
                f"{Config.default_work_lat},{Config.default_work_lng}"
                if Config.default_work_lat is not None and Config.default_work_lng is not None
                else Config.default_work_location
            )
            return origin, {"address": Config.default_work_location, "source": "work"}

        return None, {"address": None, "source": "unknown"}

    @staticmethod
    def _clean_formatted_address(address: str) -> str:
        """Normalise Google's formatted addresses for friendlier user output."""
        return re.sub(r",\s*USA$", "", address.strip())

    @classmethod
    def _addresses_equivalent(cls, left: str, right: str) -> bool:
        """Return true when two location strings are effectively the same."""
        normalize = lambda value: re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()
        return normalize(left) == normalize(right)

    @classmethod
    def _local_search_bounds(cls) -> str | None:
        """Return a bounds string that biases geocoding toward the user's local area."""
        points = [
            (Config.default_home_lat, Config.default_home_lng),
            (Config.default_work_lat, Config.default_work_lng),
        ]
        coords = [(lat, lng) for lat, lng in points if lat is not None and lng is not None]
        if not coords:
            return None

        lats = [lat for lat, _ in coords]
        lngs = [lng for _, lng in coords]
        padding = cls._LOCAL_BIAS_PADDING
        southwest = f"{min(lats) - padding},{min(lngs) - padding}"
        northeast = f"{max(lats) + padding},{max(lngs) + padding}"
        return f"{southwest}|{northeast}"

    @staticmethod
    def _looks_like_bare_place_name(destination: str) -> bool:
        """Return true for short ambiguous place names like 'Chili's'."""
        lowered = destination.lower().strip()
        if not lowered or "http" in lowered:
            return False
        if any(char.isdigit() for char in lowered):
            return False
        if "," in lowered:
            return False
        return len(lowered.split()) <= 4

    @staticmethod
    def _context_place_queries(destination: str, context_text: str | None) -> list[str]:
        """Return smarter search variants for ambiguous venues based on event context."""
        if not context_text:
            return []

        lowered_context = context_text.lower()
        queries: list[str] = []

        dining_keywords = ("dinner", "lunch", "breakfast", "brunch", "ramen", "food", "eat")
        coffee_keywords = ("coffee", "cafe", "latte", "espresso")

        if any(keyword in lowered_context for keyword in dining_keywords):
            queries.extend(
                [
                    f"{destination} restaurant",
                    f"{destination} grill & bar",
                    f"{destination} grill and bar",
                ]
            )
        elif any(keyword in lowered_context for keyword in coffee_keywords):
            queries.extend([f"{destination} cafe", f"{destination} coffee"])

        return queries

    @classmethod
    def _destination_queries(cls, destination: str, context_text: str | None = None) -> list[str]:
        """Build ordered geocoding queries for a destination string."""
        base = destination.strip()
        variants = [
            base,
            base.replace("’", "'"),
            base.replace("'", ""),
        ]

        if cls._looks_like_bare_place_name(base):
            variants.extend(cls._context_place_queries(base, context_text))

        deduped: list[str] = []
        seen: set[str] = set()
        for variant in variants:
            cleaned = variant.strip()
            key = cleaned.lower()
            if cleaned and key not in seen:
                seen.add(key)
                deduped.append(cleaned)
        return deduped

    async def _geocode_query(
        self,
        client: httpx.AsyncClient,
        query: str,
        bounds: str | None = None,
    ) -> dict:
        """Perform one geocoding request with optional local-area bias."""
        params: dict[str, str] = {
            "address": query,
            "key": Config.google_maps_key,
        }
        if bounds:
            params["bounds"] = bounds

        resp = await client.get(self.GEOCODE_URL, params=params)
        resp.raise_for_status()
        return resp.json()

    async def resolve_destination(self, destination: str, context_text: str | None = None) -> dict:
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

        bounds = self._local_search_bounds()
        queries = self._destination_queries(destination, context_text)

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                data: dict | None = None
                last_zero_results = False

                for query in queries:
                    data = await self._geocode_query(client, query, bounds=bounds)
                    status = data.get("status")
                    if status == "OK":
                        break
                    if status == "ZERO_RESULTS":
                        last_zero_results = True
                        continue
                    raise TravelEstimationError(
                        f"Google Maps could not resolve destination {destination!r}: {status}."
                    )

                if data is None:
                    data = {"status": "ZERO_RESULTS"} if last_zero_results else {"status": "ZERO_RESULTS"}
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
        origin_label: str | None = None,
        origin_source: str | None = None,
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

        if origin:
            _origin = origin
            loc_info = {
                "address": origin_label or origin,
                "source": origin_source or "explicit",
            }
        else:
            _origin, loc_info = self._default_origin()

        if not _origin:
            raise TravelEstimationError(
                "No origin is available for travel estimation. Configure DEFAULT_HOME_LOCATION "
                "or DEFAULT_WORK_LOCATION."
            )

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
