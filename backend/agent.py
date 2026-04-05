"""
agent.py — Built-in intelligence agent for Sunday.

When AGENT_MODE=builtin, Sunday uses the configured LLM (any provider)
to generate actionable insights from processed emails and voice notes,
optionally grounded with a web search. Insights are delivered via the
normal messaging channels (iMessage, Telegram).

This runs instead of — or alongside — OpenClaw when the user prefers a
self-contained setup without a separate agent process.
"""
from __future__ import annotations

import logging

import httpx

from .config import Config
from .llm_client import get_llm
from .messenger import send_text_message

log = logging.getLogger(__name__)

_SEARCH_TIMEOUT = 5.0
_AGENT_MAX_TOKENS = 300

_SYSTEM_PROMPT = """\
You are Sunday, a personal AI assistant. You receive context about a processed \
email or voice note, along with optional web search results for relevant details.

Your job: provide a brief, actionable insight — what matters, what to do, \
and any useful context from the search results.

Rules:
- 2–4 sentences max. Be direct and personal.
- If something needs action, say so clearly.
- If the search found nothing relevant, ignore it.
- Never repeat raw data the user already has (dates, times, locations).
- Do not start with "I" or "As Sunday".\
"""


async def _web_search(query: str) -> str | None:
    """Run a DuckDuckGo instant-answer search and return a brief result snippet."""
    if not query.strip():
        return None
    try:
        async with httpx.AsyncClient(timeout=_SEARCH_TIMEOUT) as client:
            resp = await client.get(
                "https://api.duckduckgo.com/",
                params={"q": query, "format": "json", "no_html": "1", "skip_disambig": "1"},
                headers={"User-Agent": "Sunday/1.0"},
            )
            resp.raise_for_status()
            data = resp.json()

        abstract = (data.get("AbstractText") or "").strip()
        if abstract:
            return abstract[:400]

        # Fall back to first related topic snippet
        for topic in data.get("RelatedTopics", []):
            text = (topic.get("Text") or "").strip()
            if text:
                return text[:400]

    except Exception as exc:
        log.debug("Web search unavailable (non-fatal): %s", exc)

    return None


def _search_query_for_email(parsed: dict, subject: str) -> str | None:
    """Build a focused web search query from email context."""
    event = parsed.get("event") or {}

    # Search for the event location / organiser if there's something concrete to look up
    location = event.get("location", "")
    organizer = event.get("organizer", "")
    title = event.get("title", "")

    if location and not event.get("is_online"):
        return location
    if organizer:
        return organizer
    if title:
        return title
    return None


def _search_query_for_note(summary: str) -> str | None:
    """Build a web search query from a voice note summary."""
    return summary.strip() or None


async def _run(context: str, search_query: str | None) -> str:
    """Call the LLM with optional web search grounding and return the insight."""
    search_snippet = None
    if search_query:
        search_snippet = await _web_search(search_query)

    user_content = context
    if search_snippet:
        user_content += f"\n\nWeb search result for '{search_query}':\n{search_snippet}"

    llm = get_llm()
    return await llm.complete(
        [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        temperature=0.4,
        max_tokens=_AGENT_MAX_TOKENS,
    )


async def notify_email_event(parsed: dict, subject: str) -> None:
    """
    Generate an insight for a processed email and send it via messaging.
    Called when AGENT_MODE=builtin.
    """
    summary = parsed.get("summary", "")
    action_items: list[str] = parsed.get("action_items") or []
    has_event = parsed.get("has_event", False)
    needs_response = parsed.get("needs_response", False)
    urgency = parsed.get("urgency", "")
    event = parsed.get("event") or {}

    lines = [f'Email: "{subject}"']
    if summary:
        lines.append(f"Summary: {summary}")
    if has_event:
        parts = [p for p in [
            event.get("title"), event.get("date"),
            event.get("start_time"), event.get("location"),
        ] if p]
        lines.append(f"Event: {' · '.join(parts)}")
    if needs_response:
        lines.append("Needs a reply.")
    if urgency and urgency not in ("none", "low"):
        lines.append(f"Urgency: {urgency}")
    if action_items:
        lines.append("Action items: " + "; ".join(action_items))

    context = "\n".join(lines)
    search_query = _search_query_for_email(parsed, subject)

    try:
        insight = await _run(context, search_query)
        await send_text_message(f"🤖 {insight}")
        log.info("  → Built-in agent insight sent")
    except Exception as exc:
        log.warning("Built-in agent failed (non-fatal): %s", exc)


async def notify_voice_note(transcript: str, summary: str) -> None:
    """
    Generate an insight for a voice note and send it via messaging.
    Called when AGENT_MODE=builtin.
    """
    context = f'Voice note: "{summary}"\nTranscript: {transcript}'
    search_query = _search_query_for_note(summary)

    try:
        insight = await _run(context, search_query)
        await send_text_message(f"🤖 {insight}")
        log.info("  → Built-in agent insight sent")
    except Exception as exc:
        log.warning("Built-in agent failed (non-fatal): %s", exc)
