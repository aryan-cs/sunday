"""
state_store.py — Helpers for runtime state files.
"""
from __future__ import annotations

from pathlib import Path

from config import Config


def get_state_dir(create: bool = False) -> Path:
    """Return the runtime state directory, creating it only when requested."""
    path = Path(Config.state_dir)
    if create:
        path.mkdir(parents=True, exist_ok=True)
    return path


def get_state_file(filename: str) -> Path:
    """Return the full path for a named state file."""
    return get_state_dir() / filename
