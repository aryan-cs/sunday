"""
errors.py — Domain-specific exceptions for the smart calendar pipeline.
"""
from __future__ import annotations


class SmartCalendarError(RuntimeError):
    """Base class for pipeline errors."""


class ConfigurationError(SmartCalendarError):
    """Raised when required configuration is missing or invalid."""


class EmailParseError(SmartCalendarError):
    """Raised when the LLM response cannot be trusted as structured email data."""


class TravelEstimationError(SmartCalendarError):
    """Raised when travel time could not be determined from real map data."""


class CalendarEventError(SmartCalendarError):
    """Raised when calendar event creation or lookup fails."""


class MessagingDeliveryError(SmartCalendarError):
    """Raised when no configured messaging channel can deliver a summary."""


class DayPlanningError(SmartCalendarError):
    """Raised when the optional day planner cannot return valid structured output."""
