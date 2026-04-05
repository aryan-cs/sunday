from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import os

from .config import Config, PROJECT_ROOT

CONFIG_FILE_PATH = PROJECT_ROOT / "config.env"


@dataclass(frozen=True)
class AppSettingDefinition:
    env_name: str
    config_attr: str
    kind: str
    options: tuple[str, ...] = ()


APP_SETTINGS: tuple[AppSettingDefinition, ...] = (
    AppSettingDefinition("TARGET_CALENDAR_ID", "target_calendar_id", "text"),
    AppSettingDefinition("TIMEZONE", "timezone", "text"),
    AppSettingDefinition("DEFAULT_HOME_LOCATION", "default_home_location", "text"),
    AppSettingDefinition("DEFAULT_HOME_LATITUDE", "default_home_lat", "optional_float"),
    AppSettingDefinition("DEFAULT_HOME_LONGITUDE", "default_home_lng", "optional_float"),
    AppSettingDefinition("DEFAULT_WORK_LOCATION", "default_work_location", "text"),
    AppSettingDefinition("DEFAULT_WORK_LATITUDE", "default_work_lat", "optional_float"),
    AppSettingDefinition("DEFAULT_WORK_LONGITUDE", "default_work_lng", "optional_float"),
    AppSettingDefinition("WORK_DAYS", "work_days", "csv"),
    AppSettingDefinition("WORKDAY_START_TIME", "workday_start_time", "time"),
    AppSettingDefinition("WORKDAY_END_TIME", "workday_end_time", "time"),
    AppSettingDefinition("TRAVEL_TYPE", "travel_mode", "choice", ("driving", "walking", "bicycling", "transit")),
    AppSettingDefinition("PREP_TIME_MINUTES", "prep_time", "int"),
    AppSettingDefinition("ONLINE_PREP_MINUTES", "online_prep", "int"),
    AppSettingDefinition("TEXT_EMAIL_LINKS", "text_email_links", "bool"),
    AppSettingDefinition("POLL_INTERVAL_SECONDS", "poll_interval", "int"),
    AppSettingDefinition("MAX_EMAILS_PER_CYCLE", "max_emails_per_cycle", "int"),
    AppSettingDefinition(
        "CONNECTED_AGENT", "connected_agent", "choice",
        ("openai", "anthropic", "gemini", "cerebras", "groq", "ollama", "openclaw"),
    ),
)

APP_SETTINGS_BY_KEY = {item.env_name: item for item in APP_SETTINGS}


def _validate_hhmm(value: str) -> str:
    try:
        datetime.strptime(value, "%H:%M")
    except ValueError as exc:
        raise ValueError("must use HH:MM 24-hour format") from exc
    return value


def _stringify_current_value(setting: AppSettingDefinition) -> str | bool:
    current = getattr(Config, setting.config_attr)
    if setting.kind == "bool":
        return bool(current)
    if setting.kind == "csv":
        return ",".join(current or [])
    if current is None:
        return ""
    return str(current)


def get_app_settings() -> dict[str, str | bool]:
    return {
        setting.env_name: _stringify_current_value(setting)
        for setting in APP_SETTINGS
    }


def _normalize_setting_value(setting: AppSettingDefinition, raw_value: str | bool | int | float | None) -> tuple[str, object]:
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

    if setting.kind == "text":
        return text, text
    if setting.kind == "optional_float":
        if not text:
            return "", None
        parsed = float(text)
        return text, parsed
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
        cleaned = text.lower()
        if cleaned not in setting.options:
            raise ValueError(f"must be one of: {', '.join(setting.options)}")
        return cleaned, cleaned

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
        setattr(Config, setting.config_attr, parsed_value)


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
