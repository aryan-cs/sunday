"""
day_planner.py — LLM-powered day planner / route optimizer.

Given a list of errands/tasks and the user's existing calendar events,
produces an optimized schedule that minimises travel and avoids conflicts.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime

from pydantic import BaseModel, Field, ValidationError, field_validator

from errors import DayPlanningError
from llm_client import parse_with_json

log = logging.getLogger(__name__)


class DayPlanItem(BaseModel):
    """Single planned stop in the day planner output."""

    time: str
    activity: str
    location: str | None = None
    duration_minutes: int | None = None
    notes: str | None = None

    @field_validator("time")
    @classmethod
    def _validate_time(cls, value: str) -> str:
        datetime.strptime(value, "%I:%M %p")
        return value


class DayPlan(BaseModel):
    """Validated day-planner response."""

    schedule: list[DayPlanItem] = Field(default_factory=list)
    reasoning: str


DAY_PLANNER_SYSTEM = """\
You are a day planner assistant. Given a list of tasks/errands and the user's
existing calendar events, produce a realistic optimized daily schedule.

Consider:
- Proximity of locations (group nearby errands together to minimise driving)
- Opening hours only when the prompt explicitly contains enough information
- Calendar conflicts (never overlap with existing events)
- Travel time between stops
- The user's default location as a starting point

Respond with ONLY valid JSON — no markdown, no explanation:
{
  "schedule": [
    {
      "time": "9:00 AM",
      "activity": "Gym",
      "location": "ARC, 201 E Peabody Dr, Champaign, IL 61820",
      "duration_minutes": 60,
      "notes": "Go here first because it is closest to your starting location."
    }
  ],
  "reasoning": "Brief explanation of why this order is optimal."
}

If a task has no specific location, set location to null.
Use 12-hour clock for times (e.g. "9:00 AM", "2:30 PM").
Do not invent business hours, travel durations, or locations that are not supported by the prompt.
"""


async def plan_day(
    tasks: list[str],
    existing_events: list[dict],
    user_location: str | None = None,
) -> dict:
    """
    Produce an optimized daily schedule for the given tasks.

    Raises:
        DayPlanningError: If the LLM cannot return valid structured output.
    """
    from location_state import get_current_location

    loc = get_current_location()
    location = user_location or loc["address"]
    location_source = loc["source"] if not user_location else "override"
    log.debug("Day planner origin: %s (source: %s)", location, location_source)

    simplified_events = [
        {
            "title": ev.get("summary", "Untitled"),
            "start": ev.get("start", {}).get("dateTime", ev.get("start", {}).get("date")),
            "end": ev.get("end", {}).get("dateTime", ev.get("end", {}).get("date")),
            "location": ev.get("location"),
        }
        for ev in existing_events
    ]

    prompt = (
        f"My starting location: {location}\n\n"
        f"Today's existing calendar events:\n"
        f"{json.dumps(simplified_events, indent=2)}\n\n"
        f"Tasks I need to complete today:\n"
        + "\n".join(f"- {task}" for task in tasks)
        + "\n\nCreate an optimized schedule that avoids conflicts and minimises travel."
    )

    try:
        raw_plan = await parse_with_json(prompt=prompt, system=DAY_PLANNER_SYSTEM, temperature=0.2)
        validated = DayPlan.model_validate(raw_plan)
    except (ValidationError, ValueError, TypeError) as exc:
        raise DayPlanningError("Day planner returned invalid structured data.") from exc
    except Exception as exc:
        raise DayPlanningError("Day planner failed.") from exc

    return validated.model_dump()


def format_schedule(plan: dict) -> str:
    """Format a day plan dict into a readable text summary."""
    lines = ["Your Optimized Day", "-" * 20]

    for item in plan.get("schedule", []):
        time = item.get("time", "?")
        act = item.get("activity", "?")
        loc = item.get("location") or ""
        dur = item.get("duration_minutes")
        notes = item.get("notes", "")

        dur_str = f" ({dur} min)" if dur else ""
        loc_str = f" — {loc}" if loc else ""
        lines.append(f"{time}  {act}{dur_str}{loc_str}")
        if notes:
            lines.append(f"  {notes}")

    if plan.get("reasoning"):
        lines.append(f"\nWhy this order: {plan['reasoning']}")

    return "\n".join(lines)
