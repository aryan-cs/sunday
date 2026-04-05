"""
llm_client.py — Unified LLM client.

The rest of the app calls `llm.complete()` and never thinks about
which provider is behind it. Supports Gemini, OpenRouter, Groq, Cerebras,
Together AI, Mistral, Ollama, HuggingFace, and any custom
OpenAI-compatible endpoint.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from email.utils import parsedate_to_datetime

import httpx

from .config import Config
from .errors import ConfigurationError, SmartCalendarError

log = logging.getLogger(__name__)


class LLMClient:
    """
    Unified async LLM client.

    Usage:
        from .llm_client import get_llm
        response = await get_llm().complete([
            {"role": "system", "content": "You are helpful."},
            {"role": "user",   "content": "Hello!"},
        ])
    """

    def __init__(self, provider: str | None = None) -> None:
        if provider is not None:
            cfg = Config.llm_providers.get(provider)
            if not cfg:
                raise ConfigurationError(
                    f"Unknown LLM provider: {provider!r}. "
                    f"Valid options: {list(Config.llm_providers.keys())}"
                )
            self.config = {**cfg, "provider_name": provider}
        else:
            self.config = Config.get_active_llm()
        self.provider = self.config["provider_name"]
        self._validate_provider_config()
        self._request_lock = asyncio.Lock()
        self._next_request_at = 0.0
        self._requests_per_minute = self._resolve_requests_per_minute()
        log.info(
            "LLMClient initialised — provider: %s, model: %s",
            self.provider,
            self.config["model"],
        )

    async def complete(
        self,
        messages: list[dict],
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        """
        Send messages to the active LLM and return the response text.
        """
        temp = temperature if temperature is not None else Config.temperature
        tokens = max_tokens if max_tokens is not None else Config.max_tokens

        if self.provider == "gemini":
            return await self._gemini(messages, temp, tokens)
        if self.provider == "huggingface":
            return await self._huggingface(messages, temp, tokens)
        if self.provider == "anthropic":
            return await self._anthropic(messages, temp, tokens)
        return await self._openai_compatible(messages, temp, tokens)

    def _validate_provider_config(self) -> None:
        """Fail fast when the active provider is not fully configured."""
        if not self.config.get("model"):
            raise ConfigurationError(
                f"LLM provider '{self.provider}' is missing a configured model."
            )

        if self.provider not in {"ollama", "anthropic"} and not self.config.get("api_key"):
            raise ConfigurationError(
                f"LLM provider '{self.provider}' requires an API key."
            )
        if self.provider == "anthropic" and not self.config.get("api_key"):
            raise ConfigurationError(
                "LLM provider 'anthropic' requires an API key (ANTHROPIC_API_KEY)."
            )

        if self.provider in {"ollama", "custom"} and not self.config.get("base_url"):  # anthropic has hardcoded URL
            raise ConfigurationError(
                f"LLM provider '{self.provider}' requires a base URL."
            )

    def _resolve_requests_per_minute(self) -> int:
        """Return the configured or provider-specific default RPM."""
        if Config.llm_requests_per_minute is not None:
            return Config.llm_requests_per_minute
        if self.provider == "gemini":
            return 12
        if self.provider == "cerebras":
            return 25
        if self.provider == "groq":
            return 20
        return 60

    async def _throttle(self) -> None:
        """Space requests to avoid stampeding provider rate limits."""
        min_interval = 60.0 / self._requests_per_minute
        async with self._request_lock:
            now = time.monotonic()
            wait_for = max(0.0, self._next_request_at - now)
            if wait_for > 0:
                log.info(
                    "LLM throttle active for provider %s; waiting %.1fs before the next request.",
                    self.provider,
                    wait_for,
                )
                await asyncio.sleep(wait_for)
                now = time.monotonic()
            self._next_request_at = now + min_interval

    async def _sleep_after_rate_limit(self, response: httpx.Response, attempt: int) -> None:
        """Sleep according to Retry-After or exponential backoff after a 429."""
        retry_after = response.headers.get("retry-after", "").strip()
        wait_seconds = 0.0

        if retry_after:
            if retry_after.isdigit():
                wait_seconds = float(retry_after)
            else:
                try:
                    retry_dt = parsedate_to_datetime(retry_after)
                    wait_seconds = max(
                        0.0,
                        retry_dt.timestamp() - time.time(),
                    )
                except (TypeError, ValueError, OverflowError):
                    wait_seconds = 0.0

        if wait_seconds <= 0:
            wait_seconds = Config.llm_retry_base_seconds * attempt

        async with self._request_lock:
            self._next_request_at = max(self._next_request_at, time.monotonic() + wait_seconds)

        log.warning(
            "LLM provider %s rate limited request (attempt %d/%d). Retrying in %.1fs.",
            self.provider,
            attempt,
            Config.llm_retry_attempts,
            wait_seconds,
        )
        await asyncio.sleep(wait_seconds)

    async def _post_with_retries(
        self,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        json_body: dict,
    ) -> dict:
        """POST with provider-aware throttling and retries for 429s."""
        for attempt in range(1, Config.llm_retry_attempts + 1):
            await self._throttle()
            try:
                async with httpx.AsyncClient(timeout=60) as client:
                    resp = await client.post(url, headers=headers, json=json_body)
                resp.raise_for_status()
                return resp.json()
            except httpx.HTTPStatusError as exc:
                status = exc.response.status_code
                if status == 429 and attempt < Config.llm_retry_attempts:
                    await self._sleep_after_rate_limit(exc.response, attempt)
                    continue
                if status == 429:
                    raise SmartCalendarError(
                        f"{self.provider} is rate limiting requests right now. "
                        "Wait a bit, reduce startup backlog, or switch providers."
                    ) from exc
                raise SmartCalendarError(
                    f"{self.provider} request failed with HTTP {status}."
                ) from exc
            except (httpx.HTTPError, ValueError) as exc:
                raise SmartCalendarError(
                    f"{self.provider} request failed while generating a completion."
                ) from exc

        raise SmartCalendarError(f"{self.provider} request retry loop exited unexpectedly.")

    async def _openai_compatible(
        self,
        messages: list[dict],
        temperature: float,
        max_tokens: int,
    ) -> str:
        """Works for: OpenRouter, Groq, Together, Mistral, Ollama, Custom."""
        headers: dict[str, str] = {"Content-Type": "application/json"}

        if self.config["api_key"]:
            headers["Authorization"] = f"Bearer {self.config['api_key']}"

        if self.provider == "openrouter":
            if Config.openrouter_site_url:
                headers["HTTP-Referer"] = Config.openrouter_site_url
            if Config.openrouter_app_name:
                headers["X-Title"] = Config.openrouter_app_name

        body = {
            "model": self.config["model"],
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }

        base = self.config["base_url"].rstrip("/")
        if self.provider == "ollama" and "/v1" not in base:
            base += "/v1"

        data = await self._post_with_retries(
            f"{base}/chat/completions",
            headers=headers,
            json_body=body,
        )

        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise SmartCalendarError(
                f"{self.provider} returned an unexpected response shape."
            ) from exc

        if not isinstance(content, str) or not content.strip():
            raise SmartCalendarError(f"{self.provider} returned an empty completion.")
        return content

    async def _gemini(
        self,
        messages: list[dict],
        temperature: float,
        max_tokens: int,
    ) -> str:
        """Google Gemini has its own REST format."""
        system_parts = [m["content"] for m in messages if m["role"] == "system"]
        chat_msgs = [m for m in messages if m["role"] != "system"]

        contents = []
        for message in chat_msgs:
            role = "model" if message["role"] == "assistant" else "user"
            contents.append({"role": role, "parts": [{"text": message["content"]}]})

        body: dict = {
            "contents": contents,
            "generationConfig": {
                "maxOutputTokens": max_tokens,
                "temperature": temperature,
            },
        }

        if system_parts:
            body["systemInstruction"] = {
                "parts": [{"text": "\n".join(system_parts)}]
            }

        data = await self._post_with_retries(
            (
                f"{self.config['base_url']}/models/{self.config['model']}"
                f":generateContent?key={self.config['api_key']}"
            ),
            json_body=body,
        )

        try:
            content = data["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError, TypeError) as exc:
            raise SmartCalendarError("Gemini returned an unexpected response shape.") from exc

        if not isinstance(content, str) or not content.strip():
            raise SmartCalendarError("Gemini returned an empty completion.")
        return content

    async def _huggingface(
        self,
        messages: list[dict],
        temperature: float,
        max_tokens: int,
    ) -> str:
        """HuggingFace Inference API (non-OpenAI format)."""
        prompt = (
            "\n".join(f"[{m['role'].title()}] {m['content']}" for m in messages)
            + "\n[Assistant]"
        )

        url = f"{self.config['base_url']}/{self.config['model']}"
        headers = {
            "Authorization": f"Bearer {self.config['api_key']}",
            "Content-Type": "application/json",
        }
        body = {
            "inputs": prompt,
            "parameters": {
                "max_new_tokens": max_tokens,
                "temperature": temperature,
                "return_full_text": False,
            },
        }

        data = await self._post_with_retries(url, headers=headers, json_body=body)

        if isinstance(data, list):
            content = data[0].get("generated_text", "")
        else:
            content = data.get("generated_text", "")

        if not isinstance(content, str) or not content.strip():
            raise SmartCalendarError("HuggingFace returned an empty completion.")
        return content


    async def _anthropic(
        self,
        messages: list[dict],
        temperature: float,
        max_tokens: int,
    ) -> str:
        """Anthropic Messages API (claude-* models)."""
        system_parts = [m["content"] for m in messages if m["role"] == "system"]
        chat_msgs = [m for m in messages if m["role"] != "system"]

        body: dict = {
            "model": self.config["model"],
            "max_tokens": max_tokens,
            "temperature": temperature,
            "messages": chat_msgs,
        }
        if system_parts:
            body["system"] = "\n".join(system_parts)

        headers = {
            "x-api-key": self.config["api_key"],
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

        data = await self._post_with_retries(
            "https://api.anthropic.com/v1/messages",
            headers=headers,
            json_body=body,
        )

        try:
            content = data["content"][0]["text"]
        except (KeyError, IndexError, TypeError) as exc:
            raise SmartCalendarError("Anthropic returned an unexpected response shape.") from exc

        if not isinstance(content, str) or not content.strip():
            raise SmartCalendarError("Anthropic returned an empty completion.")
        return content


def _strip_json_fences(raw: str) -> str:
    """Remove markdown code fences that some models wrap around JSON."""
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned.rsplit("```", 1)[0]
    return cleaned.strip()


_llm: LLMClient | None = None


def get_llm() -> LLMClient:
    """Return the module-level LLM client, creating it lazily."""
    global _llm
    if _llm is None:
        _llm = LLMClient()
    return _llm


_AGENT_TO_PROVIDER: dict[str, str | None] = {
    "sunday":    None,       # use Config.active_llm (default)
    "openai":    "openai",
    "anthropic": "anthropic",
    "gemini":    "gemini",
    "cerebras":  "cerebras",
    "groq":      "groq",
    "ollama":    "ollama",
    "openclaw":  "custom",
}


def get_llm_for_agent(agent: str) -> LLMClient:
    """Return an LLMClient for the given frontend agent name."""
    provider = _AGENT_TO_PROVIDER.get(agent.lower())
    return LLMClient(provider=provider)


async def parse_with_json(
    prompt: str,
    system: str,
    client: LLMClient | None = None,
    temperature: float = 0.1,
) -> dict:
    """
    Call the LLM and parse JSON from the response.

    Works across all providers by using aggressive prompting and
    stripping markdown fences if the model wraps the output.
    """
    _client = client or get_llm()
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": prompt},
    ]
    raw = await _client.complete(messages, temperature=temperature)
    return json.loads(_strip_json_fences(raw))
