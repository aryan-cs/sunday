from __future__ import annotations

import pytest

from errors import ConfigurationError
from travel_estimator import TravelEstimator


class _FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


class _FakeAsyncClient:
    def __init__(self, payload):
        self.payload = payload

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, url, params):
        del url, params
        return _FakeResponse(self.payload)


class _FakeMultiAsyncClient:
    def __init__(self, payloads: dict[str, dict]):
        self.payloads = payloads

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, url, params):
        del params
        return _FakeResponse(self.payloads[url])


class _QueryAwareAsyncClient:
    def __init__(self, resolver):
        self.resolver = resolver
        self.calls = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, url, params):
        self.calls.append((url, dict(params)))
        return _FakeResponse(self.resolver(url, params))


@pytest.mark.anyio
async def test_travel_estimator_requires_maps_key(monkeypatch):
    monkeypatch.setattr("travel_estimator.Config.google_maps_key", "")

    estimator = TravelEstimator()

    with pytest.raises(ConfigurationError):
        await estimator.estimate("Urbana, IL")


@pytest.mark.anyio
async def test_travel_estimator_uses_maps_response(monkeypatch):
    payload = {
        "rows": [
            {
                "elements": [
                    {
                        "status": "OK",
                        "duration": {"text": "25 mins", "value": 1500},
                        "duration_in_traffic": {"text": "30 mins", "value": 1800},
                        "distance": {"text": "12.3 mi"},
                    }
                ]
            }
        ]
    }

    monkeypatch.setattr("travel_estimator.Config.google_maps_key", "test-key")
    monkeypatch.setattr("travel_estimator.Config.prep_time", 15)
    monkeypatch.setattr("travel_estimator.Config.default_home_location", "Home")
    monkeypatch.setattr("travel_estimator.Config.default_home_lat", None)
    monkeypatch.setattr("travel_estimator.Config.default_home_lng", None)
    monkeypatch.setattr("travel_estimator.Config.default_work_location", "")
    monkeypatch.setattr(
        "travel_estimator.httpx.AsyncClient",
        lambda timeout: _FakeAsyncClient(payload),
    )

    estimator = TravelEstimator()
    result = await estimator.estimate(
        "Office",
        departure_time="2026-04-03T14:00:00",
    )

    assert result["travel_minutes"] == 30
    assert result["travel_text"] == "30 mins"
    assert result["departure_time"] == "1:15 PM"


@pytest.mark.anyio
async def test_travel_estimator_resolves_exact_destination_address(monkeypatch):
    geocode_payload = {
        "status": "OK",
        "results": [
            {
                "formatted_address": "1401 W Green St, Urbana, IL 61801, USA",
                "geometry": {"location": {"lat": 40.1106, "lng": -88.2272}},
            }
        ],
    }

    monkeypatch.setattr("travel_estimator.Config.google_maps_key", "test-key")
    monkeypatch.setattr("travel_estimator.Config.default_home_lat", 40.1165658)
    monkeypatch.setattr("travel_estimator.Config.default_home_lng", -88.2219593)
    monkeypatch.setattr(
        "travel_estimator.httpx.AsyncClient",
        lambda timeout: _FakeMultiAsyncClient(
            {
                TravelEstimator.PLACES_TEXTSEARCH_URL: {"status": "ZERO_RESULTS", "results": []},
                TravelEstimator.GEOCODE_URL: geocode_payload,
            }
        ),
    )

    estimator = TravelEstimator()
    resolved = await estimator.resolve_destination("Illini Union")

    assert resolved["formatted_address"] == "1401 W Green St, Urbana, IL 61801"
    assert resolved["display_location"] == "Illini Union (1401 W Green St, Urbana, IL 61801)"
    assert resolved["calendar_location"] == "1401 W Green St, Urbana, IL 61801"
    assert resolved["routing_destination"] == "1401 W Green St, Urbana, IL 61801"


@pytest.mark.anyio
async def test_travel_estimator_retries_ambiguous_restaurant_names_with_context(monkeypatch):
    def resolver(url, params):
        if url == TravelEstimator.PLACES_TEXTSEARCH_URL:
            query = params["query"]
            if query == "Chili's":
                return {"status": "ZERO_RESULTS", "results": []}
            if "grill" in query.lower() or "restaurant" in query.lower():
                return {
                    "status": "OK",
                    "results": [
                        {
                            "name": "Chili's Grill & Bar",
                            "formatted_address": "702 W Town Center Blvd, Champaign, IL 61822, USA",
                        }
                    ],
                }
            return {"status": "ZERO_RESULTS", "results": []}
        assert url == TravelEstimator.GEOCODE_URL
        return {"status": "ZERO_RESULTS", "results": []}

    client = _QueryAwareAsyncClient(resolver)
    monkeypatch.setattr("travel_estimator.Config.google_maps_key", "test-key")
    monkeypatch.setattr("travel_estimator.Config.default_home_lat", 40.1165658)
    monkeypatch.setattr("travel_estimator.Config.default_home_lng", -88.2219593)
    monkeypatch.setattr("travel_estimator.Config.default_work_lat", 40.1150399)
    monkeypatch.setattr("travel_estimator.Config.default_work_lng", -88.2281974)
    monkeypatch.setattr(
        "travel_estimator.httpx.AsyncClient",
        lambda timeout: client,
    )

    estimator = TravelEstimator()
    resolved = await estimator.resolve_destination(
        "Chili's",
        context_text="Dinner at Chili's with Aryan",
        origin_context="Campus Circle Urbana",
    )

    assert resolved["formatted_address"] == "702 W Town Center Blvd, Champaign, IL 61822"
    assert resolved["canonical_name"] == "Chili's Grill & Bar"
    assert resolved["display_location"] == "Chili's Grill & Bar (702 W Town Center Blvd, Champaign, IL 61822)"
    assert resolved["calendar_location"] == "Chili's Grill & Bar, 702 W Town Center Blvd, Champaign, IL 61822"
    assert any(params.get("query") == "Chili's" for _, params in client.calls if "query" in params)
    assert any(
        "restaurant" in params.get("query", "").lower() or "grill" in params.get("query", "").lower()
        for _, params in client.calls
        if "query" in params
    )
    assert any("campus circle urbana" in params.get("query", "").lower() for _, params in client.calls if "query" in params)
    assert all("location" in params and "radius" in params for _, params in client.calls if "query" in params)


@pytest.mark.anyio
async def test_travel_estimator_ranks_multiple_local_place_candidates(monkeypatch):
    def resolver(url, params):
        if url == TravelEstimator.PLACES_TEXTSEARCH_URL:
            return {
                "status": "OK",
                "results": [
                    {
                        "place_id": "far-chain",
                        "name": "Chili's Grill & Bar",
                        "formatted_address": "2450 Veterans Memorial Pkwy, St. Charles, MO 63303, USA",
                        "geometry": {"location": {"lat": 38.7850, "lng": -90.5650}},
                        "types": ["restaurant", "food"],
                    },
                    {
                        "place_id": "best-local",
                        "name": "Chili's Grill & Bar",
                        "formatted_address": "702 W Town Center Blvd, Champaign, IL 61822, USA",
                        "geometry": {"location": {"lat": 40.1414, "lng": -88.2590}},
                        "types": ["restaurant", "bar", "food"],
                        "business_status": "OPERATIONAL",
                    },
                ],
            }
        assert url == TravelEstimator.GEOCODE_URL
        return {"status": "ZERO_RESULTS", "results": []}

    client = _QueryAwareAsyncClient(resolver)
    monkeypatch.setattr("travel_estimator.Config.google_maps_key", "test-key")
    monkeypatch.setattr("travel_estimator.Config.default_home_lat", 40.1165658)
    monkeypatch.setattr("travel_estimator.Config.default_home_lng", -88.2219593)
    monkeypatch.setattr("travel_estimator.Config.default_work_lat", 40.1150399)
    monkeypatch.setattr("travel_estimator.Config.default_work_lng", -88.2281974)
    monkeypatch.setattr(
        "travel_estimator.httpx.AsyncClient",
        lambda timeout: client,
    )

    estimator = TravelEstimator()
    resolved = await estimator.resolve_destination(
        "Chili's",
        context_text="Dinner at Chili's with Aryan",
        origin_bias="40.1165658,-88.2219593",
    )

    assert resolved["canonical_name"] == "Chili's Grill & Bar"
    assert resolved["formatted_address"] == "702 W Town Center Blvd, Champaign, IL 61822"
    assert resolved["calendar_location"] == "Chili's Grill & Bar, 702 W Town Center Blvd, Champaign, IL 61822"


@pytest.mark.anyio
async def test_travel_estimator_rejects_far_unrelated_geocode_for_ambiguous_chain(monkeypatch):
    def resolver(url, params):
        if url == TravelEstimator.PLACES_TEXTSEARCH_URL:
            return {"status": "REQUEST_DENIED", "results": []}
        assert url == TravelEstimator.GEOCODE_URL
        return {
            "status": "OK",
            "results": [
                {
                    "formatted_address": "Chicago O'Hare International Airport, Terminal 1, Chicago, IL 60666, USA",
                    "geometry": {"location": {"lat": 41.9742, "lng": -87.9073}},
                    "types": ["airport", "establishment", "point_of_interest"],
                }
            ],
        }

    client = _QueryAwareAsyncClient(resolver)
    monkeypatch.setattr("travel_estimator.Config.google_maps_key", "test-key")
    monkeypatch.setattr("travel_estimator.Config.default_home_lat", 40.1165658)
    monkeypatch.setattr("travel_estimator.Config.default_home_lng", -88.2219593)
    monkeypatch.setattr(
        "travel_estimator.httpx.AsyncClient",
        lambda timeout: client,
    )

    estimator = TravelEstimator()
    resolved = await estimator.resolve_destination(
        "Chili's",
        context_text="Dinner at Chili's with Aryan",
        origin_bias="40.1165658,-88.2219593",
        origin_context="Campus Circle Urbana",
    )

    assert resolved["formatted_address"] is None
    assert resolved["display_location"] == "Chili's"
    assert resolved["calendar_location"] == "Chili's"
