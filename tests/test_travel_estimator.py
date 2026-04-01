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
    monkeypatch.setattr(
        "travel_estimator.get_current_location",
        lambda: {"address": "Home", "source": "config"},
    )
    monkeypatch.setattr("travel_estimator.get_origin_string", lambda: "Home")
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
            }
        ],
    }

    monkeypatch.setattr("travel_estimator.Config.google_maps_key", "test-key")
    monkeypatch.setattr(
        "travel_estimator.httpx.AsyncClient",
        lambda timeout: _FakeMultiAsyncClient(
            {
                TravelEstimator.GEOCODE_URL: geocode_payload,
            }
        ),
    )

    estimator = TravelEstimator()
    resolved = await estimator.resolve_destination("Illini Union")

    assert resolved["formatted_address"] == "1401 W Green St, Urbana, IL 61801"
    assert resolved["display_location"] == "Illini Union (1401 W Green St, Urbana, IL 61801)"
    assert resolved["routing_destination"] == "1401 W Green St, Urbana, IL 61801"
