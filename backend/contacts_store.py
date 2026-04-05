"""
contacts_store.py — Persistent contact profile store.

Contacts are pushed from the iOS app (expo-contacts + in-app notes)
and stored as a JSON list in .state/contacts.json. The transcript agent
reads this store to inject relevant contact context into LLM prompts.
"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path

from .state_store import get_state_file

log = logging.getLogger(__name__)

CONTACTS_FILE = "contacts.json"
_SPACE_RE = re.compile(r"\s+")
_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")


def load_contacts() -> list[dict]:
    """Return all stored contacts, or an empty list if none saved yet."""
    path = get_state_file(CONTACTS_FILE)
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        log.warning("Contacts store is corrupt or unreadable; returning empty list.")
        return []


def save_contacts(contacts: list[dict]) -> None:
    """Overwrite the contacts store with the given list."""
    path = get_state_file(CONTACTS_FILE)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(contacts, indent=2, ensure_ascii=False))
    log.info("Contacts store updated: %d contact(s)", len(contacts))


def _normalize_name(text: str) -> str:
    """Lowercase and strip punctuation for stable contact-name matching."""
    lowered = _NON_ALNUM_RE.sub(" ", text.lower())
    return _SPACE_RE.sub(" ", lowered).strip()


def _name_candidates(name: str) -> list[str]:
    """Return preferred lookup keys for a contact or recipient name."""
    normalized = _normalize_name(name)
    if not normalized:
        return []
    parts = normalized.split(" ")
    candidates = [normalized]
    if parts:
        candidates.append(parts[0])
    return [c for c in candidates if c]


def find_contacts_in_text(text: str, contacts: list[dict] | None = None) -> list[dict]:
    """
    Return contacts whose name (or first name) appears in the given text.

    Used to inject relevant contact context into transcript agent prompts.
    """
    if contacts is None:
        contacts = load_contacts()

    normalized_text = f" {_normalize_name(text)} "
    matched: list[dict] = []
    seen_ids: set[str] = set()

    for contact in contacts:
        cid = contact.get("id", contact.get("name", ""))
        if cid in seen_ids:
            continue

        name = str(contact.get("name", "")).strip()
        keys = _name_candidates(name)
        if not keys:
            continue

        found = False
        for key in keys:
            # Use space-padded matching against normalized transcript text
            # to avoid substring false positives (e.g. "an" in "another").
            if f" {key} " in normalized_text:
                found = True
                break
        if found:
            matched.append(contact)
            seen_ids.add(cid)

    return matched


def format_contact_context(contacts: list[dict]) -> str:
    """
    Render matched contacts as a compact context block for LLM injection.

    Example output:
        Sarah Johnson: peanut allergy, vegetarian
        Jake Lee: phone +12175550001
    """
    lines: list[str] = []
    for c in contacts:
        name = c.get("name", "unknown")
        parts: list[str] = []
        notes = (c.get("notes") or "").strip()
        if notes:
            parts.append(notes)
        phone = (c.get("phone") or "").strip()
        if phone:
            parts.append(f"phone {phone}")
        lines.append(f"{name}: {', '.join(parts)}" if parts else name)
    return "\n".join(lines)


def build_contact_lookup(contacts: list[dict]) -> dict[str, dict]:
    """Index contacts by normalized full and first names."""
    lookup: dict[str, dict] = {}
    for contact in contacts:
        name = str(contact.get("name", "")).strip()
        for key in _name_candidates(name):
            lookup.setdefault(key, contact)
    return lookup


def resolve_contact_for_recipient(recipient_name: str, contacts: list[dict]) -> dict | None:
    """Resolve the best matching contact for a transcript-extracted recipient name."""
    lookup = build_contact_lookup(contacts)
    for key in _name_candidates(recipient_name):
        contact = lookup.get(key)
        if contact is not None:
            return contact
    return None
