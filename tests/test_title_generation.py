from __future__ import annotations

from backend import title_generation


def test_generate_transcript_title_uses_model_output(monkeypatch):
    monkeypatch.setattr(
        title_generation,
        "_generate_title_with_model",
        lambda transcript: "Dinner With Aryan Tonight",
    )

    title = title_generation.generate_transcript_title(
        "we should plan dinner with Aryan tonight around seven"
    )

    assert title == "Dinner With Aryan Tonight"


def test_generate_transcript_title_falls_back_when_model_fails(monkeypatch):
    def fail(_: str) -> str:
        raise RuntimeError("boom")

    monkeypatch.setattr(title_generation, "_generate_title_with_model", fail)

    title = title_generation.generate_transcript_title(
        "need to pick up groceries after class"
    )

    assert title == "Need Pick Up Groceries After"


def test_generate_transcript_title_rewrites_bad_test_retake_schedule_title(monkeypatch):
    monkeypatch.setattr(
        title_generation,
        "_generate_title_with_model",
        lambda transcript: "Schedule Retaking Test On Weekdays",
    )

    title = title_generation.generate_transcript_title(
        "I failed the test yesterday. I want to retake it next week. "
        "Can you move everything so I can schedule that test, "
        "and also add time every day to study for it?"
    )

    assert title == "Test Retake Study Plan"


def test_generate_transcript_title_rewrites_lunch_with_friends_title(monkeypatch):
    monkeypatch.setattr(
        title_generation,
        "_generate_title_with_model",
        lambda transcript: "Lunch Plans Tomorrow Please",
    )

    title = title_generation.generate_transcript_title(
        "I have lunch plans with my friends tomorrow, can you put that into my calendar please?"
    )

    assert title == "Lunch Plans With Friends"


def test_generate_transcript_title_allows_reasonable_six_word_title(monkeypatch):
    monkeypatch.setattr(
        title_generation,
        "_generate_title_with_model",
        lambda transcript: "Electrical Engineering Midterm Retake Study Plan",
    )

    title = title_generation.generate_transcript_title(
        "I need to retake my electrical engineering midterm and make a study plan."
    )

    assert title == "Electrical Engineering Midterm Retake Study Plan"
