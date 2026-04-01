"""
llm_client.py — Unified LLM client.

The rest of the app calls `llm.complete()` and never thinks about
which provider is behind it. Supports Gemini, OpenRouter, Groq,
Together AI, Mistral, Ollama, HuggingFace, and any custom
OpenAI-compatible endpoint.
"""
from __future__ import annotations

import json
import logging

import httpx

from config import Config
from errors import ConfigurationError, SmartCalendarError

log = logging.getLogger(__name__)


class LLMClient:
    """
    Unified async LLM client.

    Usage:
        from llm_client import llm
        response = await llm.complete([
            {"role": "system", "content": "You are helpful."},
            {"role": "user",   "content": "Hello!"},
        ])
    """

    def __init__(self) -> None:
        self.config = Config.get_active_llm()
        self.provider = self.config["provider_name"]
        self._validate_provider_config()
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

        Args:
            messages:    List of {"role": "system"|"user"|"assistant", "content": "..."}
            temperature: Override default temperature from config.
            max_tokens:  Override default max_tokens from config.

        Returns:
            The assistant's response as a plain string.
        """
        temp = temperature if temperature is not None else Config.temperature
        tokens = max_tokens if max_tokens is not None else Config.max_tokens

        if self.provider == "gemini":
            return await self._gemini(messages, temp, tokens)
        if self.provider == "huggingface":
            return await self._huggingface(messages, temp, tokens)
        return await self._openai_compatible(messages, temp, tokens)

    def _validate_provider_config(self) -> None:
        """Fail fast when the active provider is not fully configured."""
        if not self.config.get("model"):
            raise ConfigurationError(
                f"LLM provider '{self.provider}' is missing a configured model."
            )

        if self.provider != "ollama" and not self.config.get("api_key"):
            raise ConfigurationError(
                f"LLM provider '{self.provider}' requires an API key."
            )

        if self.provider in {"ollama", "custom"} and not self.config.get("base_url"):
            raise ConfigurationError(
                f"LLM provider '{self.provider}' requires a base URL."
            )

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

        url = f"{base}/chat/completions"
        log.debug("POST %s  model=%s", url, self.config["model"])

        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(url, headers=headers, json=body)
                resp.raise_for_status()
                data = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise SmartCalendarError(
                f"{self.provider} request failed while generating a completion."
            ) from exc

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

        url = (
            f"{self.config['base_url']}/models/{self.config['model']}"
            f":generateContent?key={self.config['api_key']}"
        )
        log.debug("POST %s", url.split("?")[0])

        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(url, json=body)
                resp.raise_for_status()
                data = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise SmartCalendarError("Gemini request failed while generating a completion.") from exc

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

        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(url, headers=headers, json=body)
                resp.raise_for_status()
                data = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise SmartCalendarError(
                "HuggingFace request failed while generating a completion."
            ) from exc

        if isinstance(data, list):
            content = data[0].get("generated_text", "")
        else:
            content = data.get("generated_text", "")

        if not isinstance(content, str) or not content.strip():
            raise SmartCalendarError("HuggingFace returned an empty completion.")
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

    Args:
        prompt:      User-turn prompt.
        system:      System prompt (instruct the model to reply with JSON only).
        client:      LLMClient instance; uses the global `llm` singleton if None.
        temperature: Low temperature → more deterministic JSON output.

    Returns:
        Parsed Python dict.

    Raises:
        json.JSONDecodeError: If the response still isn't valid JSON.
    """
    _client = client or get_llm()
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": prompt},
    ]
    raw = await _client.complete(messages, temperature=temperature)
    return json.loads(_strip_json_fences(raw))
