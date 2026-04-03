"""
config.py — THE loader. Everything reads from here.

Loads config.env from the project root and exposes a Config class
that is the single source of truth for all settings.
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# Load the ONE config file from the project root
load_dotenv(Path(__file__).parent / "config.env")


def _get_optional_float(name: str) -> float | None:
    """Return a float env var, or None when unset."""
    value = os.getenv(name, "").strip()
    return float(value) if value else None


def _get_csv(name: str, default: str) -> list[str]:
    """Return a cleaned CSV env var."""
    raw = os.getenv(name, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


def _get_optional_int(name: str) -> int | None:
    """Return an int env var, or None when unset."""
    value = os.getenv(name, "").strip()
    return int(value) if value else None


def _get_with_legacy(primary: str, legacy: str, default: str = "") -> str:
    """Read a new env var name, falling back to an older legacy name."""
    return os.getenv(primary, os.getenv(legacy, default))


def _is_valid_hhmm(value: str) -> bool:
    """Return true when a config time string looks like HH:MM."""
    try:
        from datetime import datetime

        datetime.strptime(value, "%H:%M")
    except ValueError:
        return False
    return True


class Config:
    """Single source of truth for all configuration."""

    # ── LLM ──
    active_llm: str = os.getenv("ACTIVE_LLM_PROVIDER", "gemini")

    llm_providers: dict = {
        "gemini": {
            "api_key": os.getenv("GEMINI_API_KEY", ""),
            "model": os.getenv("GEMINI_MODEL", "gemini-2.0-flash"),
            "base_url": "https://generativelanguage.googleapis.com/v1beta",
        },
        "openrouter": {
            "api_key": os.getenv("OPENROUTER_API_KEY", ""),
            "model": os.getenv("OPENROUTER_MODEL", "meta-llama/llama-3.1-8b-instruct:free"),
            "base_url": "https://openrouter.ai/api/v1",
        },
        "groq": {
            "api_key": os.getenv("GROQ_API_KEY", ""),
            "model": os.getenv("GROQ_MODEL", "llama-3.1-8b-instant"),
            "base_url": "https://api.groq.com/openai/v1",
        },
        "cerebras": {
            "api_key": os.getenv("CEREBRAS_API_KEY", ""),
            "model": os.getenv("CEREBRAS_MODEL", "llama3.1-8b"),
            "base_url": "https://api.cerebras.ai/v1",
        },
        "ollama": {
            "api_key": "",
            "model": os.getenv("OLLAMA_MODEL", "llama3.1:8b"),
            "base_url": os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
        },
        "together": {
            "api_key": os.getenv("TOGETHER_API_KEY", ""),
            "model": os.getenv("TOGETHER_MODEL", "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo"),
            "base_url": "https://api.together.xyz/v1",
        },
        "mistral": {
            "api_key": os.getenv("MISTRAL_API_KEY", ""),
            "model": os.getenv("MISTRAL_MODEL", "mistral-small-latest"),
            "base_url": "https://api.mistral.ai/v1",
        },
        "huggingface": {
            "api_key": os.getenv("HUGGINGFACE_API_KEY", ""),
            "model": os.getenv("HUGGINGFACE_MODEL", "mistralai/Mistral-7B-Instruct-v0.3"),
            "base_url": "https://api-inference.huggingface.co/models",
        },
        "custom": {
            "api_key": os.getenv("CUSTOM_LLM_API_KEY", ""),
            "model": os.getenv("CUSTOM_LLM_MODEL", ""),
            "base_url": os.getenv("CUSTOM_LLM_BASE_URL", ""),
        },
    }

    # ── Google ──
    google_creds_file: str = os.getenv("GOOGLE_CREDENTIALS_FILE", "credentials.json")
    google_token_file: str = os.getenv("GOOGLE_TOKEN_FILE", "token.json")
    google_maps_key: str = os.getenv("GOOGLE_MAPS_API_KEY", "")

    # ── Messaging ──
    telegram_token: str = os.getenv("TELEGRAM_BOT_TOKEN", "")
    telegram_chat_id: str = os.getenv("TELEGRAM_CHAT_ID", "")
    imessage_enabled: bool = os.getenv("IMESSAGE_ENABLED", "false").lower() == "true"
    imessage_recipient: str = os.getenv("IMESSAGE_RECIPIENT", "")
    text_email_links: bool = os.getenv("TEXT_EMAIL_LINKS", "false").lower() == "true"

    # ── Preferences ──
    default_home_location: str = _get_with_legacy("DEFAULT_HOME_LOCATION", "MY_DEFAULT_LOCATION", "")
    default_home_lat: float | None = _get_optional_float("DEFAULT_HOME_LATITUDE")
    default_home_lng: float | None = _get_optional_float("DEFAULT_HOME_LONGITUDE")
    default_work_location: str = os.getenv("DEFAULT_WORK_LOCATION", "")
    default_work_lat: float | None = _get_optional_float("DEFAULT_WORK_LATITUDE")
    default_work_lng: float | None = _get_optional_float("DEFAULT_WORK_LONGITUDE")
    target_calendar_id: str = os.getenv("TARGET_CALENDAR_ID", "primary").strip() or "primary"
    work_days: list[str] = _get_csv("WORK_DAYS", "mon,tue,wed,thu,fri")
    workday_start_time: str = os.getenv("WORKDAY_START_TIME", "09:00")
    workday_end_time: str = os.getenv("WORKDAY_END_TIME", "17:00")
    if default_home_lat is None:
        default_home_lat = _get_optional_float("MY_DEFAULT_LATITUDE")
    if default_home_lng is None:
        default_home_lng = _get_optional_float("MY_DEFAULT_LONGITUDE")
    prep_time: int = int(os.getenv("PREP_TIME_MINUTES", "15"))
    online_prep: int = int(os.getenv("ONLINE_PREP_MINUTES", "5"))
    travel_mode: str = _get_with_legacy("TRAVEL_TYPE", "DEFAULT_TRAVEL_MODE", "driving")
    auto_cleanup_hours: int = int(os.getenv("AUTO_CLEANUP_HOURS", "24"))
    gmail_labels: list[str] = _get_csv("GMAIL_LABELS", "INBOX")
    timezone: str = os.getenv("TIMEZONE", "America/Chicago")
    state_dir: str = os.getenv("STATE_DIR", str(Path(__file__).parent / ".state"))

    # ── Filtering ──
    process_promotional: bool = os.getenv("PROCESS_PROMOTIONAL", "false").lower() == "true"

    # ── Advanced ──
    max_tokens: int = int(os.getenv("LLM_MAX_TOKENS", "1024"))
    temperature: float = float(os.getenv("LLM_TEMPERATURE", "0.3"))
    poll_interval: int = int(os.getenv("POLL_INTERVAL_SECONDS", "10"))
    max_emails_per_cycle: int = int(os.getenv("MAX_EMAILS_PER_CYCLE", "3"))
    log_level: str = os.getenv("LOG_LEVEL", "INFO")
    openrouter_site_url: str = os.getenv("OPENROUTER_SITE_URL", "")
    openrouter_app_name: str = os.getenv("OPENROUTER_APP_NAME", "Smart Calendar")
    llm_requests_per_minute: int | None = _get_optional_int("LLM_REQUESTS_PER_MINUTE")
    llm_retry_attempts: int = int(os.getenv("LLM_RETRY_ATTEMPTS", "4"))
    llm_retry_base_seconds: float = float(os.getenv("LLM_RETRY_BASE_SECONDS", "5"))

    @classmethod
    def get_active_llm(cls) -> dict:
        """Return the config dict for the currently active LLM provider."""
        provider = cls.llm_providers.get(cls.active_llm)
        if not provider:
            raise ValueError(
                f"Unknown LLM provider: {cls.active_llm!r}. "
                f"Valid options: {list(cls.llm_providers.keys())}"
            )
        return {**provider, "provider_name": cls.active_llm}

    @classmethod
    def validation_report(cls) -> dict[str, list[str]]:
        """Return blocking errors and non-blocking warnings for the current config."""
        errors: list[str] = []
        warnings: list[str] = []

        try:
            provider_cfg = cls.get_active_llm()
        except ValueError as exc:
            return {"errors": [str(exc)], "warnings": []}

        provider_name = provider_cfg["provider_name"]
        provider_key = provider_cfg.get("api_key", "").strip()
        provider_model = provider_cfg.get("model", "").strip()
        provider_base_url = provider_cfg.get("base_url", "").strip()

        if provider_name != "ollama" and not provider_key:
            errors.append(
                f"No API key set for LLM provider '{provider_name}'. "
                f"Set {provider_name.upper()}_API_KEY in config.env."
            )
        if not provider_model:
            errors.append(f"No model configured for LLM provider '{provider_name}'.")
        if provider_name in {"ollama", "custom"} and not provider_base_url:
            errors.append(f"No base URL configured for LLM provider '{provider_name}'.")

        has_env_creds = bool(os.environ.get("GOOGLE_CREDENTIALS_JSON"))
        if not Path(cls.google_creds_file).exists() and not has_env_creds:
            errors.append(
                f"Google credentials file not found: '{cls.google_creds_file}'. "
                "Provide GOOGLE_CREDENTIALS_JSON or download an OAuth client JSON."
            )

        if os.environ.get("VERCEL") and not os.environ.get("GOOGLE_TOKEN_JSON"):
            errors.append(
                "GOOGLE_TOKEN_JSON must be configured on Vercel because the OAuth browser flow "
                "cannot run in serverless execution."
            )

        if cls.travel_mode not in {"driving", "walking", "bicycling", "transit"}:
            errors.append(
                "TRAVEL_TYPE must be one of: driving, walking, bicycling, transit."
            )
        if cls.max_emails_per_cycle < 1:
            errors.append("MAX_EMAILS_PER_CYCLE must be at least 1.")
        if cls.llm_retry_attempts < 1:
            errors.append("LLM_RETRY_ATTEMPTS must be at least 1.")
        if cls.llm_retry_base_seconds <= 0:
            errors.append("LLM_RETRY_BASE_SECONDS must be greater than 0.")
        if cls.llm_requests_per_minute is not None and cls.llm_requests_per_minute < 1:
            errors.append("LLM_REQUESTS_PER_MINUTE must be at least 1 when set.")

        if cls.telegram_token and not cls.telegram_chat_id:
            errors.append("TELEGRAM_CHAT_ID is required when TELEGRAM_BOT_TOKEN is set.")
        if cls.telegram_chat_id and not cls.telegram_token:
            errors.append("TELEGRAM_BOT_TOKEN is required when TELEGRAM_CHAT_ID is set.")
        if cls.imessage_enabled and not cls.imessage_recipient:
            errors.append("IMESSAGE_RECIPIENT is required when IMESSAGE_ENABLED=true.")

        if not cls.telegram_token and not cls.imessage_enabled:
            warnings.append(
                "No messaging output configured. "
                "Summaries will fail until Telegram or iMessage is configured."
            )

        if not cls.google_maps_key:
            warnings.append(
                "GOOGLE_MAPS_API_KEY is not set. In-person events with a location "
                "cannot get travel-aware reminders until Maps is configured."
            )

        if not cls.default_home_location and not cls.default_work_location:
            warnings.append(
                "DEFAULT_HOME_LOCATION and DEFAULT_WORK_LOCATION are not set. "
                "Travel estimation requires at least one configured default location."
            )

        if (cls.default_home_lat is None) != (cls.default_home_lng is None):
            warnings.append(
                "DEFAULT_HOME_LATITUDE and DEFAULT_HOME_LONGITUDE should be set together "
                "if you want coordinate-based defaults."
            )
        if (cls.default_work_lat is None) != (cls.default_work_lng is None):
            warnings.append(
                "DEFAULT_WORK_LATITUDE and DEFAULT_WORK_LONGITUDE should be set together "
                "if you want coordinate-based work defaults."
            )
        if not _is_valid_hhmm(cls.workday_start_time):
            errors.append("WORKDAY_START_TIME must use HH:MM 24-hour format.")
        if not _is_valid_hhmm(cls.workday_end_time):
            errors.append("WORKDAY_END_TIME must use HH:MM 24-hour format.")
        valid_work_days = {"mon", "tue", "wed", "thu", "fri", "sat", "sun"}
        invalid_work_days = [day for day in cls.work_days if day.lower() not in valid_work_days]
        if invalid_work_days:
            errors.append(
                "WORK_DAYS must be a comma-separated list using mon,tue,wed,thu,fri,sat,sun."
            )

        return {"errors": errors, "warnings": warnings}
