"""
pipeline.py — Core pipeline logic shared by main.py and server.py.

Encapsulates one full pass: fetch emails → LLM parse → calendar → notify.
"""
from __future__ import annotations

import logging

from calendar_manager import CalendarManager
from config import Config
from email_parser import enrich_event_details, get_calendar_readiness_issues, parse_email, summarise_parsed
from gmail_watcher import GmailWatcher
from messenger import send_summary
from travel_estimator import TravelEstimator

log = logging.getLogger(__name__)

_gmail: GmailWatcher | None = None
_calendar: CalendarManager | None = None
_travel: TravelEstimator | None = None


def _build_gmail_thread_link(email_data: dict) -> str | None:
    """Return a Gmail web link for the source email thread when possible."""
    thread_id = (email_data.get("thread_id") or "").strip()
    if thread_id:
        return f"https://mail.google.com/mail/u/0/#all/{thread_id}"

    message_id = (email_data.get("id") or "").strip()
    if message_id:
        return f"https://mail.google.com/mail/u/0/#all/{message_id}"

    return None


def _get_singletons() -> tuple[GmailWatcher, CalendarManager, TravelEstimator]:
    global _gmail, _calendar, _travel
    if _gmail is None:
        _gmail = GmailWatcher()
    if _calendar is None:
        _calendar = CalendarManager()
    if _travel is None:
        _travel = TravelEstimator()
    return _gmail, _calendar, _travel


async def process_single_email(
    email_data: dict,
    gmail: GmailWatcher,
    calendar: CalendarManager,
    travel: TravelEstimator,
) -> dict:
    """
    Run the full pipeline on one email and return a result summary dict.

    Processing only counts as complete once the summary is delivered and
    the Gmail message is marked as processed.
    """
    log.info("Processing: %s", email_data.get("subject", "—"))

    parsed = await parse_email(email_data)
    parsed = enrich_event_details(parsed, email_data)
    log.info("  %s", summarise_parsed(parsed))

    calendar_status = "not_applicable"
    calendar_event_link: str | None = None
    processing_notes: list[str] = []
    travel_info: dict | None = None

    if parsed.get("has_event") and parsed.get("event"):
        readiness_issues = get_calendar_readiness_issues(parsed)
        if readiness_issues:
            calendar_status = "skipped_incomplete"
            processing_notes.append(
                "Calendar event was skipped: " + "; ".join(readiness_issues)
            )
        else:
            event = parsed["event"]
            if not event.get("is_online") and event.get("location"):
                departure = f"{event['date']}T{event['start_time']}:00"
                travel_info = await travel.estimate(
                    destination=event["location"],
                    departure_time=departure,
                )
                log.info("  → Travel: %d min", travel_info["travel_minutes"])

            calendar_result = calendar.create_smart_event(
                event,
                travel_info,
                source_email_id=email_data.get("id"),
            )
            calendar_status = calendar_result["status"]
            calendar_event_link = calendar_result["event"].get("htmlLink")
            log.info("  → Calendar status: %s", calendar_status)

    await send_summary(
        parsed_email=parsed,
        calendar_status=calendar_status,
        travel_info=travel_info,
        processing_notes=processing_notes,
        source_email_link=_build_gmail_thread_link(email_data),
    )
    log.info("  → Summary sent")

    gmail.mark_as_processed(email_data["id"])
    log.info("  → Gmail message marked as processed")

    return {
        "email_id": email_data.get("id"),
        "subject": email_data.get("subject"),
        "has_event": parsed.get("has_event"),
        "calendar_status": calendar_status,
        "calendar_event_link": calendar_event_link,
        "urgency": parsed.get("urgency"),
        "summary": parsed.get("summary"),
        "processing_notes": processing_notes,
    }


async def run_pipeline(max_emails: int | None = None) -> list[dict]:
    """
    Fetch new emails and run the full pipeline on each one.
    """
    gmail, calendar, travel = _get_singletons()
    email_limit = max_emails if max_emails is not None else Config.max_emails_per_cycle

    new_emails = gmail.get_new_emails(max_results=email_limit)
    if not new_emails:
        log.debug("No new emails this cycle")
        return []

    log.info("📬 %d new email(s)", len(new_emails))
    results: list[dict] = []

    for email_data in new_emails:
        try:
            results.append(await process_single_email(email_data, gmail, calendar, travel))
        except Exception as exc:
            log.error(
                "Unhandled error processing email %s: %s",
                email_data.get("id"),
                exc,
            )
            results.append(
                {
                    "email_id": email_data.get("id"),
                    "subject": email_data.get("subject"),
                    "error": str(exc),
                }
            )

    return results
