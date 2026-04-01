"""
travel_estimator.py — Travel time estimation via Google Maps Distance Matrix API.
"""
from __future__ import annotations

import logging
import math
import re
from difflib import SequenceMatcher
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
    PLACES_TEXTSEARCH_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json"
    _LOCAL_BIAS_PADDING = 0.15
    _PLACE_RESULT_LIMIT = 5
    _GEOCODE_RESULT_LIMIT = 5
    _LOCAL_SEARCH_RADIUS_METERS = 30000
    _AMBIGUOUS_RESULT_MAX_DISTANCE_METERS = 120000
    _MIN_AMBIGUOUS_GEOCODE_SCORE = 65.0

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

    @staticmethod
    def _clean_place_name(name: str) -> str:
        """Return a compact canonical place name from Google data."""
        return re.sub(r"\s+", " ", name.strip())

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

    @classmethod
    def _local_search_circle(cls, origin_bias: str | None = None) -> tuple[str | None, int | None]:
        """Return a search center/radius biased to the likely origin when available."""
        coords = cls._search_reference_points(origin_bias)
        if not coords:
            return None, None

        center_lat = sum(lat for lat, _ in coords) / len(coords)
        center_lng = sum(lng for _, lng in coords) / len(coords)
        return f"{center_lat},{center_lng}", cls._LOCAL_SEARCH_RADIUS_METERS

    @staticmethod
    def _local_search_coords() -> list[tuple[float, float]]:
        """Return configured home/work coordinates for local ranking."""
        points = [
            (Config.default_home_lat, Config.default_home_lng),
            (Config.default_work_lat, Config.default_work_lng),
        ]
        return [(lat, lng) for lat, lng in points if lat is not None and lng is not None]

    @staticmethod
    def _parse_lat_lng(value: str | None) -> tuple[float, float] | None:
        """Parse a 'lat,lng' string into floats when possible."""
        if not value:
            return None

        parts = [part.strip() for part in value.split(",")]
        if len(parts) != 2:
            return None

        try:
            return float(parts[0]), float(parts[1])
        except ValueError:
            return None

    @classmethod
    def _search_reference_points(cls, origin_bias: str | None = None) -> list[tuple[float, float]]:
        """Prefer the event origin coordinates when ranking ambiguous destinations."""
        parsed_bias = cls._parse_lat_lng(origin_bias)
        if parsed_bias is not None:
            return [parsed_bias]
        return cls._local_search_coords()

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
                    f"{destination} bar",
                    f"{destination} bar and grill",
                    f"{destination} bar & grill",
                    f"{destination} grill & bar",
                    f"{destination} grill and bar",
                ]
            )
        elif any(keyword in lowered_context for keyword in coffee_keywords):
            queries.extend([f"{destination} cafe", f"{destination} coffee"])

        return queries

    @staticmethod
    def _origin_context_queries(destination: str, origin_context: str | None) -> list[str]:
        """Return place-query variants that include the likely origin area."""
        if not origin_context:
            return []

        cleaned = re.sub(r"\s+", " ", origin_context).strip(" ,")
        if not cleaned:
            return []

        queries = [
            f"{destination} near {cleaned}",
            f"{destination} {cleaned}",
        ]

        locality_hint = ""
        if "," in cleaned:
            parts = [part.strip() for part in cleaned.split(",") if part.strip()]
            if len(parts) >= 2:
                locality_hint = ", ".join(parts[-2:])
        else:
            words = cleaned.split()
            if len(words) >= 2:
                locality_hint = " ".join(words[-2:])

        if locality_hint and locality_hint.lower() != cleaned.lower():
            queries.extend(
                [
                    f"{destination} near {locality_hint}",
                    f"{destination} {locality_hint}",
                ]
            )

        return queries

    @staticmethod
    def _normalize_search_text(text: str) -> str:
        """Normalize text for fuzzy place matching."""
        normalized = text.lower().replace("&", " and ").replace("’", "'")
        normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
        return re.sub(r"\s+", " ", normalized).strip()

    @classmethod
    def _tokenize_search_text(cls, text: str) -> set[str]:
        """Split a place name into normalized search tokens."""
        return {token for token in cls._normalize_search_text(text).split() if token}

    @staticmethod
    def _context_place_types(context_text: str | None) -> set[str]:
        """Infer preferred Google place types from the event context."""
        if not context_text:
            return set()

        lowered_context = context_text.lower()
        if any(word in lowered_context for word in ("dinner", "lunch", "breakfast", "brunch", "ramen", "food", "eat")):
            return {"restaurant", "food", "bar", "meal_takeaway"}
        if any(word in lowered_context for word in ("coffee", "cafe", "latte", "espresso")):
            return {"cafe", "coffee_shop", "bakery", "food"}
        return set()

    @classmethod
    def _candidate_text_score(cls, destination: str, query: str, candidate_text: str) -> float:
        """Return a text similarity score between the destination/query and a candidate label."""
        destination_norm = cls._normalize_search_text(destination)
        query_norm = cls._normalize_search_text(query)
        candidate_norm = cls._normalize_search_text(candidate_text)
        destination_tokens = cls._tokenize_search_text(destination)
        candidate_tokens = cls._tokenize_search_text(candidate_text)

        score = 0.0

        if destination_norm and destination_norm == candidate_norm:
            score += 120
        if destination_norm and destination_norm in candidate_norm:
            score += 75
        if query_norm and query_norm in candidate_norm:
            score += 20

        if destination_norm and candidate_norm:
            score += 45 * SequenceMatcher(None, destination_norm, candidate_norm).ratio()
        if query_norm and candidate_norm:
            score += 15 * SequenceMatcher(None, query_norm, candidate_norm).ratio()

        if destination_tokens:
            overlap = len(destination_tokens & candidate_tokens) / len(destination_tokens)
            score += 55 * overlap
            if destination_tokens <= candidate_tokens:
                score += 20

        return score

    @staticmethod
    def _haversine_distance_meters(
        lat1: float,
        lng1: float,
        lat2: float,
        lng2: float,
    ) -> float:
        """Return the straight-line distance between two coordinates."""
        earth_radius_m = 6_371_000
        phi1 = math.radians(lat1)
        phi2 = math.radians(lat2)
        d_phi = math.radians(lat2 - lat1)
        d_lambda = math.radians(lng2 - lng1)

        a = (
            math.sin(d_phi / 2) ** 2
            + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
        )
        return 2 * earth_radius_m * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    @classmethod
    def _candidate_distance_meters(
        cls,
        candidate: dict,
        reference_points: list[tuple[float, float]],
    ) -> float | None:
        """Return the candidate's distance to the active search reference points."""
        location = ((candidate.get("geometry") or {}).get("location") or {})
        lat = location.get("lat")
        lng = location.get("lng")
        if lat is None or lng is None:
            return None

        distances = [
            cls._haversine_distance_meters(lat, lng, center_lat, center_lng)
            for center_lat, center_lng in reference_points
        ]
        return min(distances) if distances else None

    @classmethod
    def _score_place_candidate(
        cls,
        destination: str,
        query: str,
        candidate: dict,
        context_text: str | None,
        reference_points: list[tuple[float, float]],
    ) -> float:
        """Score a Places candidate so we prefer the best local exact match."""
        candidate_name = cls._clean_place_name(candidate.get("name", "") or "")
        score = cls._candidate_text_score(destination, query, candidate_name)

        preferred_types = cls._context_place_types(context_text)
        candidate_types = set(candidate.get("types") or [])
        if preferred_types and candidate_types & preferred_types:
            score += 18
        elif preferred_types and "airport" in candidate_types:
            score -= 30

        if candidate.get("business_status") == "OPERATIONAL":
            score += 5

        distance_meters = cls._candidate_distance_meters(candidate, reference_points)
        if distance_meters is not None:
            score += max(0.0, 32 - min(distance_meters, 160_000) / 5_000)
            if distance_meters > cls._LOCAL_SEARCH_RADIUS_METERS * 2:
                score -= 40
        elif reference_points:
            score -= 10

        return score

    @classmethod
    def _score_geocode_candidate(
        cls,
        destination: str,
        query: str,
        candidate: dict,
        context_text: str | None,
        reference_points: list[tuple[float, float]],
    ) -> float:
        """Score a geocode candidate so vague business names stay local and relevant."""
        candidate_label = cls._clean_formatted_address(candidate.get("formatted_address", "") or "")
        score = cls._candidate_text_score(destination, query, candidate_label)

        candidate_types = set(candidate.get("types") or [])
        preferred_types = cls._context_place_types(context_text)
        if preferred_types and candidate_types & preferred_types:
            score += 15
        elif preferred_types and "airport" in candidate_types:
            score -= 45

        distance_meters = cls._candidate_distance_meters(candidate, reference_points)
        if distance_meters is not None:
            score += max(0.0, 28 - min(distance_meters, 160_000) / 6_000)
            if distance_meters > cls._AMBIGUOUS_RESULT_MAX_DISTANCE_METERS:
                score -= 55
        elif reference_points:
            score -= 15

        return score

    @classmethod
    def _select_best_place_match(
        cls,
        destination: str,
        candidates: list[tuple[str, dict]],
        context_text: str | None,
        reference_points: list[tuple[float, float]],
    ) -> dict | None:
        """Choose the strongest local match across multiple Places queries."""
        best_match: dict | None = None
        best_score = float("-inf")
        seen_scores: dict[str, float] = {}

        for query, result in candidates:
            score = cls._score_place_candidate(
                destination,
                query,
                result,
                context_text,
                reference_points,
            )
            key = (
                result.get("place_id")
                or f"{cls._clean_place_name(result.get('name', '') or '')}|"
                f"{cls._clean_formatted_address(result.get('formatted_address', '') or '')}"
            )
            if key in seen_scores and score <= seen_scores[key]:
                continue
            seen_scores[key] = score
            if score > best_score:
                best_score = score
                best_match = result

        return best_match

    @classmethod
    def _select_best_geocode_match(
        cls,
        destination: str,
        candidates: list[tuple[str, dict]],
        context_text: str | None,
        reference_points: list[tuple[float, float]],
    ) -> tuple[dict | None, float]:
        """Choose the strongest geocoded candidate and keep its confidence score."""
        best_match: dict | None = None
        best_score = float("-inf")

        for query, result in candidates:
            score = cls._score_geocode_candidate(
                destination,
                query,
                result,
                context_text,
                reference_points,
            )
            if score > best_score:
                best_score = score
                best_match = result

        return best_match, best_score

    @classmethod
    def _geocode_match_is_confident(
        cls,
        destination: str,
        candidate: dict | None,
        score: float,
        reference_points: list[tuple[float, float]],
    ) -> bool:
        """Return true when a geocode candidate is plausible for a vague destination."""
        if candidate is None:
            return False
        if not cls._looks_like_bare_place_name(destination):
            return True
        if not reference_points:
            return True

        distance_meters = cls._candidate_distance_meters(candidate, reference_points)
        if distance_meters is not None and distance_meters <= cls._AMBIGUOUS_RESULT_MAX_DISTANCE_METERS / 2:
            return True

        candidate_label = cls._clean_formatted_address(candidate.get("formatted_address", "") or "")
        if cls._tokenize_search_text(destination) & cls._tokenize_search_text(candidate_label):
            return True

        return score >= cls._MIN_AMBIGUOUS_GEOCODE_SCORE

    @classmethod
    def _build_display_location(
        cls,
        place_name: str | None,
        formatted_address: str | None,
        fallback: str,
    ) -> str:
        """Return the friendlier label we show in texts and summaries."""
        if place_name and formatted_address and not cls._addresses_equivalent(place_name, formatted_address):
            return f"{place_name} ({formatted_address})"
        if formatted_address:
            return formatted_address
        if place_name:
            return place_name
        return fallback

    @classmethod
    def _build_calendar_location(
        cls,
        place_name: str | None,
        formatted_address: str | None,
        fallback: str,
    ) -> str:
        """Return a Calendar-friendly location string that geocodes more cleanly."""
        if place_name and formatted_address and not cls._addresses_equivalent(place_name, formatted_address):
            return f"{place_name}, {formatted_address}"
        if formatted_address:
            return formatted_address
        if place_name:
            return place_name
        return fallback

    @classmethod
    def _destination_queries(
        cls,
        destination: str,
        context_text: str | None = None,
        origin_context: str | None = None,
    ) -> list[str]:
        """Build ordered geocoding queries for a destination string."""
        base = destination.strip()
        variants = [
            base,
            base.replace("’", "'"),
            base.replace("'", ""),
        ]

        if cls._looks_like_bare_place_name(base):
            variants.extend(cls._context_place_queries(base, context_text))
            variants.extend(cls._origin_context_queries(base, origin_context))

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

    async def _places_text_search(
        self,
        client: httpx.AsyncClient,
        query: str,
        location: str | None = None,
        radius: int | None = None,
    ) -> dict:
        """Perform one Places text-search request for business/venue names."""
        params: dict[str, str | int] = {
            "query": query,
            "key": Config.google_maps_key,
        }
        if location and radius:
            params["location"] = location
            params["radius"] = radius

        resp = await client.get(self.PLACES_TEXTSEARCH_URL, params=params)
        resp.raise_for_status()
        return resp.json()

    async def resolve_destination(
        self,
        destination: str,
        context_text: str | None = None,
        origin_bias: str | None = None,
        origin_context: str | None = None,
    ) -> dict:
        """
        Resolve a human place name to exact routing and display/calendar strings.

        Returns:
            {
                "query": original input,
                "canonical_name": canonical Google venue name or None,
                "formatted_address": exact address or None,
                "display_location": string suitable for texts,
                "calendar_location": string suitable for Google Calendar pinning,
                "routing_destination": best destination for Maps routing,
            }
        """
        if not Config.google_maps_key:
            raise ConfigurationError(
                "GOOGLE_MAPS_API_KEY is required for travel-aware reminders."
            )

        bounds = self._local_search_bounds()
        reference_points = self._search_reference_points(origin_bias)
        search_location, search_radius = self._local_search_circle(origin_bias)
        queries = self._destination_queries(destination, context_text, origin_context)

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                place_match: dict | None = None
                if self._looks_like_bare_place_name(destination):
                    place_candidates: list[tuple[str, dict]] = []
                    for query in queries:
                        places_data = await self._places_text_search(
                            client,
                            query,
                            location=search_location,
                            radius=search_radius,
                        )
                        status = places_data.get("status")
                        if status == "OK" and places_data.get("results"):
                            for result in places_data["results"][: self._PLACE_RESULT_LIMIT]:
                                place_candidates.append((query, result))
                            continue
                        if status in {"ZERO_RESULTS", "NOT_FOUND"}:
                            continue
                        if status and status != "OK":
                            log.debug(
                                "Places text search unavailable for %r via query %r: %s",
                                destination,
                                query,
                                status,
                            )
                            break
                    place_match = self._select_best_place_match(
                        destination,
                        place_candidates,
                        context_text,
                        reference_points,
                    )

                if place_match:
                    place_name = self._clean_place_name(place_match.get("name", "") or destination)
                    formatted_address = self._clean_formatted_address(
                        place_match.get("formatted_address", "") or destination
                    )
                    display_location = self._build_display_location(
                        place_name,
                        formatted_address,
                        destination,
                    )
                    calendar_location = self._build_calendar_location(
                        place_name,
                        formatted_address,
                        destination,
                    )

                    return {
                        "query": destination,
                        "canonical_name": place_name,
                        "formatted_address": formatted_address,
                        "display_location": display_location,
                        "calendar_location": calendar_location,
                        "routing_destination": formatted_address or place_name or destination,
                    }

                geocode_candidates: list[tuple[str, dict]] = []
                last_zero_results = False

                for query in queries:
                    data = await self._geocode_query(client, query, bounds=bounds)
                    status = data.get("status")
                    if status == "OK":
                        for result in data.get("results", [])[: self._GEOCODE_RESULT_LIMIT]:
                            geocode_candidates.append((query, result))
                        continue
                    if status == "ZERO_RESULTS":
                        last_zero_results = True
                        continue
                    raise TravelEstimationError(
                        f"Google Maps could not resolve destination {destination!r}: {status}."
                    )

                if not geocode_candidates:
                    data = {"status": "ZERO_RESULTS"} if last_zero_results else {"status": "ZERO_RESULTS"}
                else:
                    best_match, best_score = self._select_best_geocode_match(
                        destination,
                        geocode_candidates,
                        context_text,
                        reference_points,
                    )
                    if not self._geocode_match_is_confident(
                        destination,
                        best_match,
                        best_score,
                        reference_points,
                    ):
                        data = {"status": "ZERO_RESULTS"}
                    else:
                        data = {"status": "OK", "results": [best_match]}
        except (httpx.HTTPError, ValueError) as exc:
            raise TravelEstimationError("Google Maps geocoding request failed.") from exc

        status = data.get("status")
        if status == "ZERO_RESULTS":
            return {
                "query": destination,
                "canonical_name": None,
                "formatted_address": None,
                "display_location": destination,
                "calendar_location": destination,
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

        display_location = self._build_display_location(destination, formatted_address, destination)
        calendar_location = self._build_calendar_location(None, formatted_address, destination)

        return {
            "query": destination,
            "canonical_name": None,
            "formatted_address": formatted_address,
            "display_location": display_location,
            "calendar_location": calendar_location,
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
