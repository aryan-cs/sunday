from __future__ import annotations

import logging
import re
import threading
from pathlib import Path

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

from .config import Config

log = logging.getLogger(__name__)

_STOP_WORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "but",
    "by",
    "for",
    "from",
    "i",
    "if",
    "in",
    "into",
    "is",
    "it",
    "of",
    "on",
    "or",
    "so",
    "that",
    "the",
    "this",
    "to",
    "we",
    "with",
    "you",
}
_WORD_RE = re.compile(r"[A-Za-z0-9']+")
_MODEL_LOCK = threading.Lock()
_TITLE_MODEL = None
_TITLE_TOKENIZER = None
_TITLE_DEVICE = "cpu"


class TitleGenerationError(RuntimeError):
    """Raised when the local title model cannot generate a summary title."""


def _fallback_title(transcript: str) -> str:
    words = _WORD_RE.findall(transcript)
    meaningful_words = [word for word in words if word.lower() not in _STOP_WORDS]
    selected = (meaningful_words if len(meaningful_words) >= 3 else words)[:5]
    if not selected:
        return "Untitled Voice Note"
    return " ".join(word.capitalize() for word in selected)


def fallback_transcript_title(transcript: str) -> str:
    """Return the lightweight heuristic fallback title without model inference."""
    return _fallback_title(transcript)


def _resolve_device() -> str:
    requested = (Config.transcript_title_device or "auto").strip().lower()
    if requested in {"mps", "cpu"}:
        if requested == "mps" and not torch.backends.mps.is_available():
            log.warning("TRANSCRIPT_TITLE_DEVICE=mps requested, but MPS is unavailable. Falling back to CPU.")
            return "cpu"
        return requested
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _load_title_model():
    global _TITLE_MODEL, _TITLE_TOKENIZER, _TITLE_DEVICE
    if _TITLE_MODEL is not None and _TITLE_TOKENIZER is not None:
        return _TITLE_MODEL, _TITLE_TOKENIZER, _TITLE_DEVICE

    model_path = Path(Config.transcript_title_model_path)
    if not model_path.exists():
        raise TitleGenerationError(f"Title model not found: {model_path}")

    with _MODEL_LOCK:
        if _TITLE_MODEL is not None and _TITLE_TOKENIZER is not None:
            return _TITLE_MODEL, _TITLE_TOKENIZER, _TITLE_DEVICE

        _TITLE_DEVICE = _resolve_device()
        log.info("Loading transcript title model from %s on %s", model_path, _TITLE_DEVICE)

        tokenizer = AutoTokenizer.from_pretrained(
            model_path,
            local_files_only=True,
            trust_remote_code=False,
        )
        if tokenizer.pad_token_id is None and tokenizer.eos_token_id is not None:
            tokenizer.pad_token = tokenizer.eos_token

        model_kwargs: dict = {
            "local_files_only": True,
            "trust_remote_code": False,
        }
        if _TITLE_DEVICE == "mps":
            model_kwargs["dtype"] = torch.float16

        model = AutoModelForCausalLM.from_pretrained(model_path, **model_kwargs)
        model.to(_TITLE_DEVICE)
        model.eval()
        for attr in ("temperature", "top_p", "top_k"):
            if hasattr(model.generation_config, attr):
                setattr(model.generation_config, attr, None)

        _TITLE_MODEL = model
        _TITLE_TOKENIZER = tokenizer
        return _TITLE_MODEL, _TITLE_TOKENIZER, _TITLE_DEVICE


def _build_prompt(tokenizer, transcript: str) -> str:
    messages = [
        {
            "role": "system",
            "content": "You create extremely short titles for voice note transcripts.",
        },
        {
            "role": "user",
            "content": (
                "Summarize this transcript in exactly 5 words. "
                "Be concrete and specific. Use plain words. "
                "Output only the title, with no quotes or extra commentary.\n\n"
                f"Transcript:\n{transcript}"
            ),
        },
    ]

    if hasattr(tokenizer, "apply_chat_template"):
        return tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
        )

    return messages[-1]["content"]


def _normalize_generated_title(raw_text: str, transcript: str) -> str:
    words = _WORD_RE.findall(raw_text)
    if len(words) < 3:
        return _fallback_title(transcript)
    return " ".join(word.capitalize() for word in words[:5])


def _generate_title_with_model(transcript: str) -> str:
    model, tokenizer, device = _load_title_model()
    prompt = _build_prompt(tokenizer, transcript)
    inputs = tokenizer(prompt, return_tensors="pt")
    inputs = {key: value.to(device) for key, value in inputs.items()}

    generate_kwargs = {
        **inputs,
        "max_new_tokens": max(6, Config.transcript_title_max_new_tokens),
        "do_sample": False,
        "pad_token_id": tokenizer.pad_token_id or tokenizer.eos_token_id,
        "eos_token_id": tokenizer.eos_token_id,
    }

    with _MODEL_LOCK, torch.no_grad():
        output = model.generate(**generate_kwargs)

    generated_tokens = output[0][inputs["input_ids"].shape[1]:]
    generated_text = tokenizer.decode(generated_tokens, skip_special_tokens=True).strip()
    return _normalize_generated_title(generated_text, transcript)


def generate_transcript_title(transcript: str) -> str:
    cleaned = transcript.strip()
    if not cleaned:
        return "Untitled Voice Note"

    try:
        return _generate_title_with_model(cleaned)
    except Exception as exc:  # pragma: no cover - backend fallback path is tested via monkeypatch
        log.warning("Falling back to heuristic transcript title: %s", exc)
        return _fallback_title(cleaned)
