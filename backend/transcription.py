from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path

import httpx

from .config import Config


class TranscriptionError(RuntimeError):
    """Raised when speech transcription fails."""


def _normalize_transcript(text: str) -> str:
    parts = [line.strip() for line in text.splitlines() if line.strip()]
    return " ".join(parts).strip()


def _friendly_transcription_error(detail: str) -> str:
    message = detail.strip()
    lowered = message.lower()

    if "file is empty" in lowered or "audio file is too short" in lowered or "too short" in lowered:
        return "Recording was too short. Hold the button a little longer and try again."

    return message


def _looks_like_short_audio_error(detail: str) -> bool:
    lowered = detail.lower()
    return (
        "file is empty" in lowered
        or "audio file is too short" in lowered
        or "too short" in lowered
        or "minimum audio length" in lowered
    )


# ── Groq Whisper API (cloud, no model file needed) ────────────────────────────

def _transcribe_via_groq(source: Path) -> str:
    """Transcribe using Groq's hosted Whisper API."""
    api_key = os.getenv("GROQ_API_KEY", "")
    if not api_key:
        raise TranscriptionError("GROQ_API_KEY is not set.")

    try:
        size = source.stat().st_size
    except OSError as exc:
        raise TranscriptionError(f"Could not read recording: {source}") from exc
    if size <= 0:
        raise TranscriptionError("Recorded audio was empty. Please try again.")

    with open(source, "rb") as f:
        audio_bytes = f.read()

    suffix = source.suffix or ".m4a"
    mime = (
        "audio/webm" if suffix in {".webm", ".weba"}
        else "audio/wav" if suffix == ".wav"
        else "audio/mpeg" if suffix == ".mp3"
        else "audio/mp4"
    )

    response = httpx.post(
        "https://api.groq.com/openai/v1/audio/transcriptions",
        headers={"Authorization": f"Bearer {api_key}"},
        data={"model": "whisper-large-v3-turbo", "language": Config.transcription_language},
        files={"file": (source.name, audio_bytes, mime)},
        timeout=60,
    )

    if response.status_code != 200:
        raise TranscriptionError(_friendly_transcription_error(response.text))

    text = response.json().get("text", "").strip()
    if not text:
        raise TranscriptionError("Groq returned an empty transcript.")
    return text


# ── Local whisper.cpp (fallback when model file exists) ───────────────────────

def _run_checked_command(command: list[str], label: str) -> None:
    try:
        completed = subprocess.run(command, check=False, capture_output=True, text=True)
    except FileNotFoundError as exc:
        raise TranscriptionError(f"{label} is not installed or not on PATH.") from exc

    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise TranscriptionError(f"{label} failed: {detail}")


def _ffmpeg_to_wav(source: Path, destination: Path) -> None:
    _run_checked_command([
        "ffmpeg", "-y", "-i", str(source),
        "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(destination),
    ], "ffmpeg")


def _whisper_local(source: Path, output_prefix: Path) -> None:
    threads = max(1, min(Config.transcription_threads, os.cpu_count() or 4))
    _run_checked_command([
        "whisper-cpp",
        "-m", Config.transcription_model_path,
        str(source),
        "-l", Config.transcription_language,
        "-t", str(threads),
        "-otxt", "-of", str(output_prefix),
        "-nt", "-np",
    ], "whisper-cpp")


def _transcribe_locally(source: Path) -> str:
    model_path = Path(Config.transcription_model_path)
    if not model_path.exists():
        raise TranscriptionError(f"Speech model not found: {model_path}")

    with tempfile.TemporaryDirectory(prefix="sunday-transcription-") as tmp:
        tmp_root = Path(tmp)
        wav_path = tmp_root / "recording.wav"
        output_prefix = tmp_root / "transcript"

        _ffmpeg_to_wav(source, wav_path)
        _whisper_local(wav_path, output_prefix)

        transcript_path = output_prefix.with_suffix(".txt")
        if not transcript_path.exists():
            raise TranscriptionError("whisper-cpp did not produce a transcript file.")

        text = _normalize_transcript(transcript_path.read_text())
        if not text:
            raise TranscriptionError("No speech was transcribed from the recording.")
        return text


def _transcribe_via_groq_wav_retry(source: Path) -> str:
    with tempfile.TemporaryDirectory(prefix="sunday-groq-wav-") as tmp:
        wav_path = Path(tmp) / "recording.wav"
        _ffmpeg_to_wav(source, wav_path)
        return _transcribe_via_groq(wav_path)


# ── Public entry point ────────────────────────────────────────────────────────

def transcribe_audio_file(source: str | Path) -> str:
    """
    Transcribe an audio file.

    Priority:
      1. Groq Whisper API  — if GROQ_API_KEY is set (cloud, no model needed)
      2. Local whisper.cpp — if model file exists on disk
    """
    source_path = Path(source)
    if not source_path.exists():
        raise TranscriptionError(f"Audio file not found: {source_path}")

    if os.getenv("GROQ_API_KEY"):
        try:
            return _transcribe_via_groq(source_path)
        except TranscriptionError as exc:
            if _looks_like_short_audio_error(str(exc)):
                try:
                    if source_path.stat().st_size > 4096:
                        return _transcribe_via_groq_wav_retry(source_path)
                except (OSError, TranscriptionError):
                    pass
            raise

    return _transcribe_locally(source_path)
