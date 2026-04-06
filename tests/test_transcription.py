from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from backend import transcription
from backend.transcription import TranscriptionError, transcribe_audio_file


def test_transcribe_audio_file_converts_audio_and_reads_transcript(tmp_path, monkeypatch):
    audio_path = tmp_path / "input.m4a"
    audio_path.write_bytes(b"fake-audio")
    monkeypatch.delenv("GROQ_API_KEY", raising=False)

    model_path = tmp_path / "model.bin"
    model_path.write_bytes(b"fake-model")

    monkeypatch.setattr(transcription.Config, "transcription_model_path", str(model_path))
    monkeypatch.setattr(transcription.Config, "transcription_language", "en")
    monkeypatch.setattr(transcription.Config, "transcription_threads", 4)

    commands: list[list[str]] = []

    def fake_run(command, check, capture_output, text):
        del check, capture_output, text
        commands.append(command)
        if command[0] == "ffmpeg":
            Path(command[-1]).write_bytes(b"wav")
        else:
            output_prefix = Path(command[command.index("-of") + 1])
            output_prefix.with_suffix(".txt").write_text("hello\nworld\n")
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    monkeypatch.setattr(transcription.subprocess, "run", fake_run)

    transcript = transcribe_audio_file(audio_path)

    assert transcript == "hello world"
    assert commands[0][0] == "ffmpeg"
    assert commands[1][0] == "whisper-cpp"
    assert commands[1][commands[1].index("-m") + 1] == str(model_path)


def test_transcribe_audio_file_raises_when_model_is_missing(tmp_path, monkeypatch):
    audio_path = tmp_path / "input.m4a"
    audio_path.write_bytes(b"fake-audio")
    monkeypatch.delenv("GROQ_API_KEY", raising=False)

    monkeypatch.setattr(
        transcription.Config,
        "transcription_model_path",
        str(tmp_path / "missing-model.bin"),
    )

    with pytest.raises(TranscriptionError, match="Speech model not found"):
        transcribe_audio_file(audio_path)
