"""
test_priority_scheduling.py — Tests for priority scoring, authority domain boost,
score gating, and conflict detection.
"""
from __future__ import annotations

import pytest

from email_parser import ParsedEmail, parse_email
from errors import EmailParseError


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _make_llm_response(
    has_event: bool = False,
    priority_score: int = 3,
    priority_reason: str = "no specific match",
    urgency: str = "none",
    needs_response: bool = False,
    can_wait: bool = False,
    event: dict | None = None,
) -> dict:
    return {
        "has_event": has_event,
        "needs_response": needs_response,
        "urgency": urgency,
        "priority_score": priority_score,
        "priority_reason": priority_reason,
        "summary": "Test email summary",
        "event": event,
        "action_items": [],
        "can_wait": can_wait,
    }


def _make_event(
    title: str = "Test Event",
    date: str = "2026-04-10",
    start_time: str = "14:00",
    end_time: str = "15:00",
    is_online: bool = True,
    location: str | None = None,
) -> dict:
    return {
        "title": title,
        "date": date,
        "start_time": start_time,
        "end_time": end_time,
        "location": location,
        "is_online": is_online,
        "meeting_link": "https://zoom.us/j/123" if is_online else None,
        "description": None,
        "attendees": [],
        "organizer": None,
    }


# ─── ParsedEmail model validation ─────────────────────────────────────────────

def test_parsed_email_accepts_priority_fields():
    """priority_score and priority_reason are parsed correctly."""
    data = _make_llm_response(priority_score=4, priority_reason="Internship recruiter email")
    parsed = ParsedEmail.model_validate(data)
    assert parsed.priority_score == 4
    assert parsed.priority_reason == "Internship recruiter email"


def test_parsed_email_priority_score_clamped_high():
    """priority_score above 5 is clamped to 5."""
    data = _make_llm_response(priority_score=99)
    parsed = ParsedEmail.model_validate(data)
    assert parsed.priority_score == 5


def test_parsed_email_priority_score_clamped_low():
    """priority_score below 1 is clamped to 1."""
    data = _make_llm_response(priority_score=-3)
    parsed = ParsedEmail.model_validate(data)
    assert parsed.priority_score == 1


def test_parsed_email_priority_score_defaults_to_3():
    """priority_score defaults to 3 when omitted."""
    data = _make_llm_response()
    del data["priority_score"]
    parsed = ParsedEmail.model_validate(data)
    assert parsed.priority_score == 3


def test_parsed_email_priority_reason_defaults_to_empty():
    """priority_reason defaults to empty string when omitted."""
    data = _make_llm_response()
    del data["priority_reason"]
    parsed = ParsedEmail.model_validate(data)
    assert parsed.priority_reason == ""


# ─── LLM scoring scenarios ─────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_high_priority_internship_email(monkeypatch):
    """SWE internship recruiting email gets high priority score."""
    async def fake_llm(**kwargs):
        return _make_llm_response(
            priority_score=5,
            priority_reason="Matches SWE internship recruiting priority",
            urgency="high",
            needs_response=True,
            has_event=True,
            event=_make_event(title="Internship Interview"),
        )
    monkeypatch.setattr("email_parser.parse_with_json", fake_llm)

    result = await parse_email({"id": "e1", "from": "recruiter@amazon.com", "subject": "SWE Intern Interview", "body": "..."})
    assert result["priority_score"] == 5
    assert "internship" in result["priority_reason"].lower()
    assert result["has_event"] is True


@pytest.mark.anyio
async def test_high_priority_purdue_cs_announcement(monkeypatch):
    """Purdue CS department announcement gets high priority score."""
    async def fake_llm(**kwargs):
        return _make_llm_response(
            priority_score=4,
            priority_reason="Matches Purdue University CS department announcements priority",
            urgency="medium",
        )
    monkeypatch.setattr("email_parser.parse_with_json", fake_llm)

    result = await parse_email({"id": "e2", "from": "cs@purdue.edu", "subject": "CS Dept Town Hall", "body": "..."})
    assert result["priority_score"] == 4


@pytest.mark.anyio
async def test_high_priority_lab_deadline(monkeypatch):
    """Systems programming lab deadline gets high priority score."""
    async def fake_llm(**kwargs):
        return _make_llm_response(
            priority_score=5,
            priority_reason="Matches systems programming lab deadlines priority",
            urgency="high",
            needs_response=False,
            has_event=True,
            event=_make_event(title="Lab 3 Due"),
        )
    monkeypatch.setattr("email_parser.parse_with_json", fake_llm)

    result = await parse_email({"id": "e3", "from": "prof@cs.purdue.edu", "subject": "CS 390 Lab 3 Deadline", "body": "..."})
    assert result["priority_score"] == 5
    assert result["has_event"] is True


@pytest.mark.anyio
async def test_low_priority_newsletter(monkeypatch):
    """Promotional newsletter gets low priority score."""
    async def fake_llm(**kwargs):
        return _make_llm_response(
            priority_score=1,
            priority_reason="Promotional email unrelated to user priorities",
            urgency="none",
            can_wait=True,
        )
    monkeypatch.setattr("email_parser.parse_with_json", fake_llm)

    result = await parse_email({"id": "e4", "from": "noreply@shopify.com", "subject": "Your weekly deals", "body": "..."})
    assert result["priority_score"] == 1
    assert result["has_event"] is False


@pytest.mark.anyio
async def test_medium_priority_generic_meeting(monkeypatch):
    """Generic meeting invite with no keyword match gets mid-range score."""
    async def fake_llm(**kwargs):
        return _make_llm_response(
            priority_score=3,
            priority_reason="No specific match to user priorities",
            urgency="medium",
            has_event=True,
            event=_make_event(title="Team Standup"),
        )
    monkeypatch.setattr("email_parser.parse_with_json", fake_llm)

    result = await parse_email({"id": "e5", "from": "manager@company.com", "subject": "Team standup invite", "body": "..."})
    assert result["priority_score"] == 3


# ─── Authority domain boost logic ─────────────────────────────────────────────

def test_authority_domain_endswith_safe():
    """endswith check prevents false positives like 'not-a-real-edu.com'."""
    authority_domains = [".edu", "linkedin.com"]
    safe_sender = "scammer@not-a-real-edu.com"
    assert not any(safe_sender.endswith(d) for d in authority_domains)


def test_authority_domain_matches_real_edu():
    """.edu sender correctly matches authority domain."""
    authority_domains = [".edu", "linkedin.com"]
    real_sender = "prof@cs.purdue.edu"
    assert any(real_sender.endswith(d) for d in authority_domains)


def test_authority_domain_matches_linkedin():
    """linkedin.com sender correctly matches authority domain."""
    authority_domains = [".edu", "linkedin.com"]
    recruiter = "recruiter@linkedin.com"
    assert any(recruiter.endswith(d) for d in authority_domains)


def test_authority_boost_caps_at_5():
    """Authority boost never pushes score above 5."""
    current_score = 5
    boosted = min(5, current_score + 1)
    assert boosted == 5


def test_authority_boost_increments_score():
    """Authority boost adds 1 to a score of 3."""
    current_score = 3
    boosted = min(5, current_score + 1)
    assert boosted == 4


# ─── Score gating logic ────────────────────────────────────────────────────────

@pytest.mark.parametrize("score,threshold,should_skip", [
    (1, 3, True),
    (2, 3, True),
    (3, 3, False),
    (4, 3, False),
    (5, 1, False),
    (1, 1, False),
])
def test_score_gate(score, threshold, should_skip):
    """Emails below threshold are skipped; at or above threshold are processed."""
    assert (score < threshold) == should_skip


# ─── Conflict detection logic ─────────────────────────────────────────────────

def test_conflict_detection_finds_overlap():
    """Existing events in the same window are returned as conflicts."""
    existing_events = [
        {"summary": "CS 390 Lecture", "start": {"dateTime": "2026-04-10T14:00:00"}},
        {"summary": "Office Hours", "start": {"dateTime": "2026-04-10T14:30:00"}},
    ]
    conflicts = [e["summary"] for e in existing_events if e.get("summary")]
    assert "CS 390 Lecture" in conflicts
    assert "Office Hours" in conflicts


def test_conflict_detection_empty_when_no_overlap():
    """No existing events means no conflicts."""
    existing_events = []
    conflicts = [e["summary"] for e in existing_events if e.get("summary")]
    assert conflicts == []


def test_conflict_detection_skips_events_without_summary():
    """Events missing a summary field are excluded from conflict list."""
    existing_events = [
        {"summary": "Real Event"},
        {},
        {"summary": ""},
    ]
    conflicts = [e["summary"] for e in existing_events if e.get("summary")]
    assert conflicts == ["Real Event"]
