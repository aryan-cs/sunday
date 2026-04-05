"""
action_center_store.py — Persisted Action Center feed entries.

Stores backend-generated entries (for example Gmail pipeline outcomes)
so the mobile app can fetch and display them.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from .state_store import get_state_file

_ACTION_CENTER_STATE_FILE = "action_center_entries.json"
_ACTION_CENTER_MAX_ENTRIES = 300


def load_action_center_entries() -> list[dict]:
    path = get_state_file(_ACTION_CENTER_STATE_FILE)
    if not path.exists():
        return []
    try:
        raw = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return []
    if not isinstance(raw, list):
        return []
    return [item for item in raw if isinstance(item, dict)]


def save_action_center_entries(entries: list[dict]) -> None:
    path = get_state_file(_ACTION_CENTER_STATE_FILE)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(entries[:_ACTION_CENTER_MAX_ENTRIES]))


def merge_action_center_entries(existing: list[dict], incoming: list[dict]) -> list[dict]:
    merged_by_id: dict[str, dict] = {}
    for entry in existing:
        entry_id = str(entry.get("id") or "").strip()
        if entry_id:
            merged_by_id[entry_id] = entry

    for entry in incoming:
        entry_id = str(entry.get("id") or "").strip()
        if entry_id:
            merged_by_id[entry_id] = entry

    merged = list(merged_by_id.values())
    merged.sort(key=lambda item: str(item.get("createdAt") or ""), reverse=True)
    return merged[:_ACTION_CENTER_MAX_ENTRIES]


def action_center_entry_from_pipeline_result(result: dict) -> dict | None:
    """Convert one Gmail pipeline result into an app Action Center entry."""
    email_id = str(result.get("email_id") or "").strip()
    if not email_id:
        return None

    calendar_status = str(result.get("calendar_status") or "").strip()
    has_event = bool(result.get("has_event"))
    if not has_event and not calendar_status.startswith("skipped"):
        return None

    event = result.get("event") if isinstance(result.get("event"), dict) else {}
    title = str(event.get("title") or result.get("subject") or "Email event").strip()
    notes: list[str] = []
    summary = str(result.get("summary") or "").strip()
    if summary:
        notes.append(summary)
    for note in result.get("processing_notes") or []:
        note_text = str(note).strip()
        if note_text:
            notes.append(note_text)
    link = str(result.get("calendar_event_link") or "").strip()
    if link:
        notes.append(f"Calendar link: {link}")

    status = "complete" if calendar_status in {"created", "existing"} else "failed"
    description = "\n".join(notes).strip() or None
    created_at = datetime.now(timezone.utc).isoformat()

    action = {
        "type": "calendar_event",
        "title": title,
        "date": event.get("date"),
        "start_time": event.get("start_time"),
        "end_time": event.get("end_time"),
        "location": event.get("location"),
        "is_online": event.get("is_online"),
        "description": description,
        "executed": status == "complete",
        "conflict": False,
        "conflict_with": None,
    }

    return {
        "id": f"email-{email_id}",
        "summary": title,
        "transcript": description or "Processed from Gmail.",
        "createdAt": created_at,
        "status": status,
        "audioUri": None,
        "actions": [action],
    }


def append_action_center_entries_from_pipeline_results(results: list[dict]) -> int:
    """Map pipeline results to entries and persist merged feed; return count added."""
    incoming = [
        entry
        for entry in (action_center_entry_from_pipeline_result(item) for item in results)
        if entry is not None
    ]
    if not incoming:
        return 0

    stored = load_action_center_entries()
    merged = merge_action_center_entries(stored, incoming)
    save_action_center_entries(merged)
    return len(incoming)


def get_recent_action_center_entries(limit: int = 100) -> list[dict]:
    safe_limit = max(1, min(limit, _ACTION_CENTER_MAX_ENTRIES))
    entries = load_action_center_entries()
    entries.sort(key=lambda item: str(item.get("createdAt") or ""), reverse=True)
    return entries[:safe_limit]
