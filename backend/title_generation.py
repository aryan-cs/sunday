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
    "my",
    "please",
}
_WORD_RE = re.compile(r"[A-Za-z0-9']+")
_MODEL_LOCK = threading.Lock()
_TITLE_MODEL = None
_TITLE_TOKENIZER = None
_TITLE_DEVICE = "cpu"
_IMPERATIVE_LEADS = {
    "add",
    "arrange",
    "build",
    "change",
    "create",
    "make",
    "move",
    "organize",
    "plan",
    "put",
    "remind",
    "reschedule",
    "schedule",
    "set",
}
_TITLE_PREFIX_WORDS = {"title", "summary", "caption", "headline"}
_TRAILING_NOISE_WORDS = {"calendar", "weekdays", "weekday"}
_TEST_WORDS = {"test", "exam", "midterm", "quiz"}
_RETAKE_WORDS = {"retake", "retaking", "retest", "redo"}
_STUDY_WORDS = {"study", "studying", "practice", "review"}
_MEAL_WORDS = ("breakfast", "brunch", "coffee", "dinner", "lunch")
_RELATION_TITLE_MAP = {
    "advisor": "Advisor",
    "coworker": "Coworker",
    "coworkers": "Coworkers",
    "dad": "Dad",
    "family": "Family",
    "friend": "Friends",
    "friends": "Friends",
    "mom": "Mom",
    "parents": "Parents",
    "professor": "Professor",
    "roommate": "Roommate",
    "roommates": "Roommates",
    "team": "Team",
}


class TitleGenerationError(RuntimeError):
    """Raised when the local title model cannot generate a summary title."""


def _transcript_words(text: str) -> list[str]:
    return [word.lower() for word in _WORD_RE.findall(text)]


def _contains_any(words: list[str], options: set[str]) -> bool:
    return any(word in options for word in words)


def _special_case_title(transcript: str) -> str | None:
    words = _transcript_words(transcript)
    has_test = _contains_any(words, _TEST_WORDS)
    has_retake = _contains_any(words, _RETAKE_WORDS)
    has_study = _contains_any(words, _STUDY_WORDS)

    if has_test and has_retake and has_study:
        return "Test Retake Study Plan"
    if has_test and has_retake:
        return "Test Retake Plan"
    if has_test and has_study:
        return "Test Study Plan"

    meal_word = next((word for word in words if word in _MEAL_WORDS), None)
    relation_title = next(
        (_RELATION_TITLE_MAP[word] for word in words if word in _RELATION_TITLE_MAP),
        None,
    )
    if meal_word and relation_title:
        return f"{meal_word.capitalize()} Plans With {relation_title}"
    return None


def _fallback_title(transcript: str) -> str:
    special_case = _special_case_title(transcript)
    if special_case:
        return special_case

    words = _WORD_RE.findall(transcript)
    meaningful_words = [word for word in words if word.lower() not in _STOP_WORDS]
    selected = (meaningful_words if len(meaningful_words) >= 3 else words)[:5]
    if not selected:
        return "Untitled Voice Note"
    return " ".join(word.capitalize() for word in selected)


def _finalize_title_words(words: list[str]) -> str:
    titled_words = [word.capitalize() for word in words]
    if not titled_words:
        return "Untitled Voice Note"

    reasonable_title = " ".join(titled_words)
    while len(titled_words) > 4 and (
        len(titled_words) > 8 or len(reasonable_title) > 48
    ):
        titled_words = titled_words[:-1]
        reasonable_title = " ".join(titled_words)

    return reasonable_title


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
            "content": (
                "You create extremely short titles for voice note transcripts. "
                "Your job is to write compact noun-phrase titles, not commands."
            ),
        },
        {
            "role": "user",
            "content": (
                "Write a short, strong title for this voice note. "
                "Use the shortest phrase that clearly captures the main subject. "
                "Do not force a fixed word count, but keep it concise. "
                "Make it a noun phrase, not a request, sentence, or command. "
                "Focus on the main topic or people involved, not minor scheduling details. "
                "Do not start with verbs like schedule, move, add, create, or remind. "
                "Do not include filler words like please, can you, or tomorrow unless they are essential to the topic. "
                "Output only the title, with no quotes or extra commentary.\n\n"
                "Good examples:\n"
                "- Transcript about failing a test, retaking it next week, and adding study blocks -> Test Retake Study Plan\n"
                "- Transcript about lunch with friends tomorrow -> Lunch Plans With Friends\n"
                "- Transcript about dinner with family this weekend -> Dinner Plans With Family\n"
                "- Transcript about paying the electric bill Friday -> Electric Bill Friday Reminder\n\n"
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
    first_line = next((line.strip() for line in raw_text.splitlines() if line.strip()), "")
    words = _WORD_RE.findall(first_line)
    while words and words[0].lower() in _TITLE_PREFIX_WORDS:
        words = words[1:]
    while words and words[0].lower() in _IMPERATIVE_LEADS:
        words = words[1:]
    while words and words[-1].lower() in _TRAILING_NOISE_WORDS:
        words = words[:-1]
    while words and words[-1].lower() == "please":
        words = words[:-1]

    if len(words) < 2:
        return _fallback_title(transcript)

    lowered_words = [word.lower() for word in words]
    if lowered_words[0] in _IMPERATIVE_LEADS:
        return _fallback_title(transcript)

    special_case = _special_case_title(transcript)
    if special_case:
        if (
            any(word in _TRAILING_NOISE_WORDS for word in lowered_words)
            or "retaking" in lowered_words
            or "schedule" in lowered_words
            or "please" in lowered_words
            or ("plans" in lowered_words and "friends" not in lowered_words and "family" not in lowered_words)
        ):
            return special_case

    return _finalize_title_words(words)


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
    return tokenizer.decode(generated_tokens, skip_special_tokens=True).strip()


def generate_transcript_title(transcript: str) -> str:
    cleaned = transcript.strip()
    if not cleaned:
        return "Untitled Voice Note"

    try:
        generated = _generate_title_with_model(cleaned)
        return _normalize_generated_title(generated, cleaned)
    except Exception as exc:  # pragma: no cover - backend fallback path is tested via monkeypatch
        log.warning("Falling back to heuristic transcript title: %s", exc)
        return _fallback_title(cleaned)
