from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import os

from .config import Config, PROJECT_ROOT

CONFIG_FILE_PATH = PROJECT_ROOT / "config.env"

_AGENT_MODE_OPTIONS = ("off", "openclaw", "builtin")
_TRAVEL_TYPE_OPTIONS = ("driving", "walking", "bicycling", "transit")
_PROVIDER_OPTIONS = tuple(Config.llm_providers.keys())
_TITLE_DEVICE_OPTIONS = ("auto", "cpu", "mps", "cuda")
_LOG_LEVEL_OPTIONS = ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL")
_PATH_ENV_KEYS = {
    "GOOGLE_CREDENTIALS_FILE",
    "GOOGLE_TOKEN_FILE",
    "STATE_DIR",
    "TRANSCRIPTION_MODEL_PATH",
    "TRANSCRIPT_TITLE_MODEL_PATH",
}


@dataclass(frozen=True)
class AppSettingDefinition:
    env_name: str
    config_attr: str
    kind: str
    options: tuple[str, ...] = ()


APP_SETTINGS: tuple[AppSettingDefinition, ...] = (
    AppSettingDefinition("ACTIVE_LLM_PROVIDER", "active_llm", "choice", _PROVIDER_OPTIONS),
    AppSettingDefinition("GEMINI_API_KEY", "llm_providers.gemini.api_key", "secret"),
    AppSettingDefinition("GEMINI_MODEL", "llm_providers.gemini.model", "text"),
    AppSettingDefinition("OPENROUTER_API_KEY", "llm_providers.openrouter.api_key", "secret"),
    AppSettingDefinition("OPENROUTER_MODEL", "llm_providers.openrouter.model", "text"),
    AppSettingDefinition("OPENROUTER_SITE_URL", "openrouter_site_url", "text"),
    AppSettingDefinition("OPENROUTER_APP_NAME", "openrouter_app_name", "text"),
    AppSettingDefinition("SUNDAY_API_KEY", "sunday_api_key", "secret"),
    AppSettingDefinition("OPENAI_API_KEY", "openai_api_key", "secret"),
    AppSettingDefinition("ANTHROPIC_API_KEY", "anthropic_api_key", "secret"),
    AppSettingDefinition("AGENT_MODE", "agent_mode", "choice", _AGENT_MODE_OPTIONS),
    AppSettingDefinition("OPENCLAW_BASE_URL", "openclaw_base_url", "text"),
    AppSettingDefinition("OPENCLAW_TOKEN", "openclaw_token", "secret"),
    AppSettingDefinition("OPENCLAW_ENABLED", "openclaw_enabled", "bool"),
    AppSettingDefinition("GROQ_API_KEY", "llm_providers.groq.api_key", "secret"),
    AppSettingDefinition("GROQ_MODEL", "llm_providers.groq.model", "text"),
    AppSettingDefinition("CEREBRAS_API_KEY", "llm_providers.cerebras.api_key", "secret"),
    AppSettingDefinition("CEREBRAS_MODEL", "llm_providers.cerebras.model", "text"),
    AppSettingDefinition("OLLAMA_BASE_URL", "llm_providers.ollama.base_url", "text"),
    AppSettingDefinition("OLLAMA_MODEL", "llm_providers.ollama.model", "text"),
    AppSettingDefinition("TOGETHER_API_KEY", "llm_providers.together.api_key", "secret"),
    AppSettingDefinition("TOGETHER_MODEL", "llm_providers.together.model", "text"),
    AppSettingDefinition("MISTRAL_API_KEY", "llm_providers.mistral.api_key", "secret"),
    AppSettingDefinition("MISTRAL_MODEL", "llm_providers.mistral.model", "text"),
    AppSettingDefinition("HUGGINGFACE_API_KEY", "llm_providers.huggingface.api_key", "secret"),
    AppSettingDefinition("HUGGINGFACE_MODEL", "llm_providers.huggingface.model", "text"),
    AppSettingDefinition("CUSTOM_LLM_BASE_URL", "llm_providers.custom.base_url", "text"),
    AppSettingDefinition("CUSTOM_LLM_API_KEY", "llm_providers.custom.api_key", "secret"),
    AppSettingDefinition("CUSTOM_LLM_MODEL", "llm_providers.custom.model", "text"),
    AppSettingDefinition("GOOGLE_CREDENTIALS_FILE", "google_creds_file", "path"),
    AppSettingDefinition("GOOGLE_TOKEN_FILE", "google_token_file", "path"),
    AppSettingDefinition("GOOGLE_MAPS_API_KEY", "google_maps_key", "secret"),
    AppSettingDefinition("TARGET_CALENDAR_ID", "target_calendar_id", "text"),
    AppSettingDefinition("TELEGRAM_BOT_TOKEN", "telegram_token", "secret"),
    AppSettingDefinition("TELEGRAM_CHAT_ID", "telegram_chat_id", "secret"),
    AppSettingDefinition("IMESSAGE_ENABLED", "imessage_enabled", "bool"),
    AppSettingDefinition("IMESSAGE_RECIPIENT", "imessage_recipient", "text"),
    AppSettingDefinition("TEXT_EMAIL_LINKS", "text_email_links", "bool"),
    AppSettingDefinition("DEFAULT_HOME_LOCATION", "default_home_location", "text"),
    AppSettingDefinition("DEFAULT_HOME_LATITUDE", "default_home_lat", "optional_float"),
    AppSettingDefinition("DEFAULT_HOME_LONGITUDE", "default_home_lng", "optional_float"),
    AppSettingDefinition("DEFAULT_WORK_LOCATION", "default_work_location", "text"),
    AppSettingDefinition("DEFAULT_WORK_LATITUDE", "default_work_lat", "optional_float"),
    AppSettingDefinition("DEFAULT_WORK_LONGITUDE", "default_work_lng", "optional_float"),
    AppSettingDefinition("WORK_DAYS", "work_days", "csv"),
    AppSettingDefinition("WORKDAY_START_TIME", "workday_start_time", "time"),
    AppSettingDefinition("WORKDAY_END_TIME", "workday_end_time", "time"),
    AppSettingDefinition("PREP_TIME_MINUTES", "prep_time", "int"),
    AppSettingDefinition("ONLINE_PREP_MINUTES", "online_prep", "int"),
    AppSettingDefinition("TRAVEL_TYPE", "travel_mode", "choice", _TRAVEL_TYPE_OPTIONS),
    AppSettingDefinition("AUTO_CLEANUP_HOURS", "auto_cleanup_hours", "int"),
    AppSettingDefinition("GMAIL_LABELS", "gmail_labels", "csv"),
    AppSettingDefinition("TIMEZONE", "timezone", "text"),
    AppSettingDefinition("STATE_DIR", "state_dir", "path"),
    AppSettingDefinition("LLM_MAX_TOKENS", "max_tokens", "int"),
    AppSettingDefinition("LLM_TEMPERATURE", "temperature", "float"),
    AppSettingDefinition("POLL_INTERVAL_SECONDS", "poll_interval", "int"),
    AppSettingDefinition("MAX_EMAILS_PER_CYCLE", "max_emails_per_cycle", "int"),
    AppSettingDefinition("LLM_REQUESTS_PER_MINUTE", "llm_requests_per_minute", "optional_int"),
    AppSettingDefinition("LLM_RETRY_ATTEMPTS", "llm_retry_attempts", "int"),
    AppSettingDefinition("LLM_RETRY_BASE_SECONDS", "llm_retry_base_seconds", "float"),
    AppSettingDefinition("TRANSCRIPTION_MODEL_PATH", "transcription_model_path", "model_path"),
    AppSettingDefinition("TRANSCRIPTION_LANGUAGE", "transcription_language", "text"),
    AppSettingDefinition("TRANSCRIPTION_THREADS", "transcription_threads", "int"),
    AppSettingDefinition("TRANSCRIPT_TITLE_MODEL_PATH", "transcript_title_model_path", "model_path"),
    AppSettingDefinition("TRANSCRIPT_TITLE_DEVICE", "transcript_title_device", "choice", _TITLE_DEVICE_OPTIONS),
    AppSettingDefinition(
        "TRANSCRIPT_TITLE_MAX_NEW_TOKENS",
        "transcript_title_max_new_tokens",
        "int",
    ),
    AppSettingDefinition("LOG_LEVEL", "log_level", "choice", _LOG_LEVEL_OPTIONS),
)

APP_SETTINGS_BY_KEY = {item.env_name: item for item in APP_SETTINGS}


def _validate_hhmm(value: str) -> str:
    try:
        datetime.strptime(value, "%H:%M")
    except ValueError as exc:
        raise ValueError("must use HH:MM 24-hour format") from exc
    return value


def _read_runtime_value(path: str):
    current: object = Config
    for segment in path.split("."):
        if isinstance(current, dict):
            current = current[segment]
        else:
            current = getattr(current, segment)
    return current


def _write_runtime_value(path: str, value: object) -> None:
    current: object = Config
    segments = path.split(".")
    for segment in segments[:-1]:
        if isinstance(current, dict):
            current = current[segment]
        else:
            current = getattr(current, segment)

    last = segments[-1]
    if isinstance(current, dict):
        current[last] = value
    else:
        setattr(current, last, value)


def _resolve_project_path(value: str) -> str:
    path = Path(value)
    if path.is_absolute():
        return str(path)
    return str(PROJECT_ROOT / path)


def _display_model_name(value: str) -> str:
    path = Path(value.strip())
    return path.stem if path.suffix else path.name


def _discover_transcription_models() -> list[str]:
    names: set[str] = set()
    root = PROJECT_ROOT / "models" / "transcription"
    if root.exists():
        for file in root.rglob("*.bin"):
            if file.is_file():
                names.add(file.stem)
    configured_path = Path(Config.transcription_model_path)
    if configured_path.exists():
        names.add(_display_model_name(Config.transcription_model_path))
    return sorted(names, key=str.lower)


def _discover_summarization_models() -> list[str]:
    names: set[str] = set()
    root = PROJECT_ROOT / "models" / "text"
    if root.exists():
        for gguf_file in root.rglob("*.gguf"):
            if gguf_file.is_file():
                names.add(gguf_file.stem)
        for config_file in root.rglob("config.json"):
            parent = config_file.parent
            has_weights = any(parent.glob("*.safetensors")) or any(parent.glob("pytorch_model*.bin"))
            if has_weights:
                names.add(parent.name)
    configured_path = Path(Config.transcript_title_model_path)
    configured_dir = configured_path if configured_path.is_dir() else configured_path.parent
    if (
        configured_path.suffix == ".gguf"
        and configured_path.exists()
    ) or (
        configured_dir.exists()
        and (
            any(configured_dir.glob("*.safetensors")) or any(configured_dir.glob("pytorch_model*.bin"))
        )
    ):
        names.add(_display_model_name(Config.transcript_title_model_path))
    return sorted(names, key=str.lower)


def _resolve_model_path(setting: AppSettingDefinition, raw_value: str) -> str:
    if "/" in raw_value or "\\" in raw_value or raw_value.endswith((".bin", ".gguf")):
        return _resolve_project_path(raw_value)

    model_name = raw_value.strip()
    if not model_name:
        return ""

    options = (
        _discover_transcription_models()
        if setting.env_name == "TRANSCRIPTION_MODEL_PATH"
        else _discover_summarization_models()
    )
    if model_name not in options:
        return _resolve_project_path(raw_value)

    roots = (
        [PROJECT_ROOT / "models" / "transcription"]
        if setting.env_name == "TRANSCRIPTION_MODEL_PATH"
        else [PROJECT_ROOT / "models" / "text"]
    )
    for root in roots:
        if not root.exists():
            continue
        matches = list(root.rglob(f"{model_name}.gguf")) + list(root.rglob(f"{model_name}.bin"))
        if matches:
            return str(matches[0])
        directory = root / model_name
        if directory.exists():
            return str(directory)

    return _resolve_project_path(raw_value)


def _stringify_current_value(setting: AppSettingDefinition) -> str | bool:
    current = _read_runtime_value(setting.config_attr)
    if setting.kind == "bool":
        return bool(current)
    if setting.kind == "csv":
        return ",".join(current or [])
    if setting.kind in {"path", "model_path"}:
        raw = os.getenv(setting.env_name, "").strip()
        return raw or ("" if current is None else str(current))
    if current is None:
        return ""
    return str(current)


def get_app_settings() -> dict[str, str | bool]:
    return {
        setting.env_name: _stringify_current_value(setting)
        for setting in APP_SETTINGS
    }


def _normalize_setting_value(
    setting: AppSettingDefinition,
    raw_value: str | bool | int | float | None,
) -> tuple[str, object]:
    if setting.kind == "bool":
        if isinstance(raw_value, bool):
            parsed = raw_value
        else:
            text = str(raw_value or "").strip().lower()
            if text in {"true", "1", "yes", "on"}:
                parsed = True
            elif text in {"false", "0", "no", "off", ""}:
                parsed = False
            else:
                raise ValueError("must be true or false")
        return ("true" if parsed else "false"), parsed

    text = "" if raw_value is None else str(raw_value).strip()

    if setting.kind in {"text", "secret"}:
        return text, text
    if setting.kind == "path":
        return text, _resolve_project_path(text) if text else ""
    if setting.kind == "model_path":
        return text, _resolve_model_path(setting, text)
    if setting.kind == "optional_float":
        if not text:
            return "", None
        parsed = float(text)
        return text, parsed
    if setting.kind == "float":
        parsed = float(text)
        return str(parsed), parsed
    if setting.kind == "optional_int":
        if not text:
            return "", None
        parsed = int(text)
        if parsed < 0:
            raise ValueError("must be at least 0")
        return str(parsed), parsed
    if setting.kind == "int":
        parsed = int(text)
        if parsed < 0:
            raise ValueError("must be at least 0")
        return str(parsed), parsed
    if setting.kind == "csv":
        items = [item.strip().lower() for item in text.split(",") if item.strip()]
        cleaned = ",".join(items)
        return cleaned, items
    if setting.kind == "time":
        cleaned = _validate_hhmm(text)
        return cleaned, cleaned
    if setting.kind == "choice":
        option_lookup = {option.lower(): option for option in setting.options}
        cleaned = text.lower()
        if cleaned not in option_lookup:
            raise ValueError(f"must be one of: {', '.join(setting.options)}")
        canonical = option_lookup[cleaned]
        return canonical, canonical

    raise ValueError("unsupported setting type")


def _upsert_config_lines(lines: list[str], updates: dict[str, str]) -> list[str]:
    result = list(lines)
    for key, value in updates.items():
        replacement = f"{key}={value}"
        replaced = False
        for index, line in enumerate(result):
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            if stripped.startswith(f"{key}="):
                result[index] = replacement
                replaced = True
                break
        if not replaced:
            if result and result[-1].strip():
                result.append("")
            result.append(replacement)
    return result


def _persist_updates_to_config(updates: dict[str, str]) -> None:
    lines = CONFIG_FILE_PATH.read_text().splitlines() if CONFIG_FILE_PATH.exists() else []
    updated_lines = _upsert_config_lines(lines, updates)
    CONFIG_FILE_PATH.write_text("\n".join(updated_lines).rstrip() + "\n")


def _apply_runtime_updates(normalized: dict[str, tuple[str, object]]) -> None:
    for env_name, (env_value, parsed_value) in normalized.items():
        os.environ[env_name] = env_value
        setting = APP_SETTINGS_BY_KEY[env_name]
        _write_runtime_value(setting.config_attr, parsed_value)


def update_app_settings(updates: dict[str, str | bool | int | float | None]) -> dict[str, str | bool]:
    unknown = sorted(set(updates) - set(APP_SETTINGS_BY_KEY))
    if unknown:
        raise ValueError(f"Unknown settings: {', '.join(unknown)}")

    normalized: dict[str, tuple[str, object]] = {}
    for key, raw_value in updates.items():
        setting = APP_SETTINGS_BY_KEY[key]
        try:
            normalized[key] = _normalize_setting_value(setting, raw_value)
        except ValueError as exc:
            raise ValueError(f"{key} {exc}") from exc

    _persist_updates_to_config({key: env_value for key, (env_value, _) in normalized.items()})
    _apply_runtime_updates(normalized)
    return get_app_settings()
