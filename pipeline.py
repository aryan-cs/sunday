"""
pipeline.py — Core pipeline logic shared by main.py and server.py.

Encapsulates one full pass: fetch emails → LLM parse → calendar → notify.
"""
from __future__ import annotations

import logging
from urllib.parse import urlparse

from calendar_manager import CalendarManager
from config import Config
from email_parser import enrich_event_details, get_calendar_readiness_issues, parse_email, summarise_parsed
from errors import ConfigurationError, TravelEstimationError
from gmail_watcher import GmailWatcher
from location_requests import create_location_request, format_location_request_message, wait_for_location_response
from messenger import send_phone_location_request, send_summary
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


def _is_location_request_enabled() -> bool:
    """Return true when the on-demand iPhone location request flow is configured."""
    if not Config.request_phone_location or not Config.location_request_base_url:
        return False

    parsed = urlparse(Config.location_request_base_url)
    return bool(parsed.scheme and parsed.netloc)


async def _request_phone_origin_for_event(
    event: dict,
    email_data: dict,
    processing_notes: list[str],
) -> tuple[str | None, str | None]:
    """
    Request the phone's current location for one event and wait briefly for a reply.

    Returns:
        (origin_for_maps, human_readable_origin_address)
    """
    if not _is_location_request_enabled():
        return None, None

    try:
        request = create_location_request(event, source_email_id=email_data.get("id"))
        await send_phone_location_request(format_location_request_message(request))
    except (ConfigurationError, ValueError, RuntimeError) as exc:
        log.warning("  → Phone location request unavailable: %s", exc)
        processing_notes.append(f"Phone location request unavailable: {exc}")
        return None, None
    except Exception as exc:
        log.warning("  → Phone location request failed: %s", exc)
        processing_notes.append(f"Phone location request failed: {exc}")
        return None, None

    response = await wait_for_location_response(
        request["request_id"],
        Config.location_request_timeout_seconds,
    )
    if response is None:
        processing_notes.append("Phone location request timed out; used fallback origin instead.")
        return None, None

    return f"{response['lat']},{response['lng']}", response.get("address")


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
                routing_destination = event["location"]
                requested_origin, requested_origin_address = await _request_phone_origin_for_event(
                    event,
                    email_data,
                    processing_notes,
                )
                origin_for_maps = requested_origin
                origin_label = requested_origin_address
                origin_source = "phone_request" if requested_origin else None

                if (
                    _is_location_request_enabled()
                    and requested_origin is None
                    and Config.default_home_location
                ):
                    origin_for_maps = Config.default_home_location
                    origin_label = Config.default_home_location
                    origin_source = "config"

                try:
                    resolved_location = await travel.resolve_destination(event["location"])
                except (ConfigurationError, TravelEstimationError) as exc:
                    log.warning("  → Exact address lookup unavailable: %s", exc)
                    processing_notes.append(f"Exact address lookup unavailable: {exc}")
                else:
                    event["location"] = resolved_location["display_location"]
                    routing_destination = resolved_location["routing_destination"]

                departure = f"{event['date']}T{event['start_time']}:00"
                try:
                    travel_info = await travel.estimate(
                        destination=routing_destination,
                        departure_time=departure,
                        origin=origin_for_maps,
                        origin_label=origin_label,
                        origin_source=origin_source,
                    )
                except (ConfigurationError, TravelEstimationError) as exc:
                    log.warning("  → Travel estimation unavailable: %s", exc)
                    processing_notes.append(f"Travel estimate unavailable: {exc}")
                else:
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
