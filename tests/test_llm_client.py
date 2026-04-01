from __future__ import annotations

import httpx
import pytest

from llm_client import LLMClient


class _FakeResponse:
    def __init__(self, status_code: int, payload: dict, headers: dict[str, str] | None = None):
        self.status_code = status_code
        self._payload = payload
        self.headers = headers or {}
        self.request = httpx.Request("POST", "https://example.com")

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            response = httpx.Response(
                self.status_code,
                headers=self.headers,
                request=self.request,
            )
            raise httpx.HTTPStatusError(
                f"HTTP {self.status_code}",
                request=self.request,
                response=response,
            )

    def json(self) -> dict:
        return self._payload


class _FakeAsyncClient:
    def __init__(self, responses: list[_FakeResponse]):
        self._responses = responses

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def post(self, url, headers=None, json=None):
        del url, headers, json
        return self._responses.pop(0)


@pytest.mark.anyio
async def test_post_with_retries_retries_429_then_succeeds(monkeypatch):
    client = object.__new__(LLMClient)
    client.provider = "gemini"
    client._request_lock = __import__("asyncio").Lock()
    client._next_request_at = 0.0
    client._requests_per_minute = 60

    responses = [
        _FakeResponse(429, {}, {"retry-after": "0"}),
        _FakeResponse(200, {"ok": True}),
    ]

    monkeypatch.setattr("llm_client.Config.llm_retry_attempts", 2)
    monkeypatch.setattr("llm_client.Config.llm_retry_base_seconds", 0.01)
    monkeypatch.setattr(
        "llm_client.httpx.AsyncClient",
        lambda timeout: _FakeAsyncClient(responses),
    )

    payload = await client._post_with_retries(
        "https://example.com",
        json_body={"hello": "world"},
    )

    assert payload == {"ok": True}


@pytest.mark.anyio
async def test_post_with_retries_raises_clear_error_after_final_429(monkeypatch):
    client = object.__new__(LLMClient)
    client.provider = "gemini"
    client._request_lock = __import__("asyncio").Lock()
    client._next_request_at = 0.0
    client._requests_per_minute = 60

    responses = [_FakeResponse(429, {}, {"retry-after": "0"})]

    monkeypatch.setattr("llm_client.Config.llm_retry_attempts", 1)
    monkeypatch.setattr(
        "llm_client.httpx.AsyncClient",
        lambda timeout: _FakeAsyncClient(responses),
    )

    with pytest.raises(Exception) as exc:
        await client._post_with_retries(
            "https://example.com",
            json_body={"hello": "world"},
        )

    assert "rate limiting" in str(exc.value)
