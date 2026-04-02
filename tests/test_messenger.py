from __future__ import annotations

import pytest

from errors import MessagingDeliveryError
from messenger import format_leave_alert, format_summary, send_summary, send_text_message


def test_format_summary_for_event_is_informal_without_inline_email_link(monkeypatch):
    monkeypatch.setattr("messenger.Config.timezone", "America/Chicago")

    message = format_summary(
        parsed_email={
            "has_event": True,
            "summary": "Meet Aryan for lunch at the Union at 3 PM.",
            "event": {
                "title": "Lunch meeting with Aryan Gupta",
                "date": "2099-04-01",
                "start_time": "15:00",
                "location": "Illini Union (1401 W Green St, Urbana, IL 61801)",
                "is_online": False,
            },
        },
        travel_info={"departure_time": "2:35 PM"},
        source_email_link="https://mail.google.com/mail/u/0/#all/thread-123",
    )

    assert "⏰ lunch meeting w/ aryan at illini union!" in message
    assert "📍 Illini Union (1401 W Green St, Urbana, IL 61801)" in message
    assert "🕐 Apr 1 at 3:00pm" in message
    assert "🚗 leave by 2:35pm" in message
    assert "original email:" not in message


def test_format_summary_separates_notes_with_blank_line(monkeypatch):
    monkeypatch.setattr("messenger.Config.timezone", "America/Chicago")

    message = format_summary(
        parsed_email={
            "has_event": True,
            "summary": "Meet Aryan for dinner at the Union at 7 PM.",
            "event": {
                "title": "Dinner meeting with Aryan Gupta",
                "date": "2099-04-01",
                "start_time": "19:00",
                "location": "Illini Union (1401 W Green St, Urbana, IL 61801)",
                "is_online": False,
            },
        },
        travel_info={"departure_time": "6:41 PM"},
        processing_notes=["Used fallback origin instead."],
    )

    assert "\n\nℹ️ Used fallback origin instead." in message


def test_format_leave_alert_uses_urgent_text_and_location():
    message = format_leave_alert(
        {
            "summary": "Dinner meeting with Aryan Gupta",
            "location": "Oozu Ramen, 601 S 6th St #102, Champaign, IL 61820",
            "extendedProperties": {
                "private": {
                    "smartCalendarDisplayLocation": "Oozu Ramen (601 S 6th St #102, Champaign, IL 61820)"
                }
            },
        }
    )

    assert message.startswith("‼️ hey, it's time to leave for dinner at oozu ramen w/ aryan!")
    assert "📍 Oozu Ramen (601 S 6th St #102, Champaign, IL 61820)" in message


@pytest.mark.anyio
async def test_send_summary_sends_email_link_as_follow_up_message(monkeypatch):
    sent_messages: list[str] = []

    async def fake_send(self, message: str) -> bool:
        del self
        sent_messages.append(message)
        return True

    monkeypatch.setattr("messenger.Config.telegram_token", "token")
    monkeypatch.setattr("messenger.Config.telegram_chat_id", "chat")
    monkeypatch.setattr("messenger.Config.imessage_enabled", False)
    monkeypatch.setattr("messenger.Config.text_email_links", True)
    monkeypatch.setattr("messenger.TelegramMessenger.send", fake_send)

    await send_summary(
        parsed_email={
            "has_event": True,
            "summary": "Meet Aryan for lunch at the Union at 3 PM.",
            "event": {
                "title": "Lunch meeting with Aryan Gupta",
                "date": "2099-04-01",
                "start_time": "15:00",
                "location": "Illini Union (1401 W Green St, Urbana, IL 61801)",
                "is_online": False,
            },
        },
        source_email_link="https://mail.google.com/mail/u/0/#all/thread-123",
    )

    assert len(sent_messages) == 2
    assert sent_messages[0].startswith("⏰ lunch meeting w/ aryan at illini union!")
    assert sent_messages[1] == "https://mail.google.com/mail/u/0/#all/thread-123"


@pytest.mark.anyio
async def test_send_summary_skips_email_link_when_text_email_links_disabled(monkeypatch):
    sent_messages: list[str] = []

    async def fake_send(self, message: str) -> bool:
        del self
        sent_messages.append(message)
        return True

    monkeypatch.setattr("messenger.Config.telegram_token", "token")
    monkeypatch.setattr("messenger.Config.telegram_chat_id", "chat")
    monkeypatch.setattr("messenger.Config.imessage_enabled", False)
    monkeypatch.setattr("messenger.Config.text_email_links", False)
    monkeypatch.setattr("messenger.TelegramMessenger.send", fake_send)

    await send_summary(
        parsed_email={
            "has_event": True,
            "summary": "Meet Aryan for lunch at the Union at 3 PM.",
            "event": {
                "title": "Lunch meeting with Aryan Gupta",
                "date": "2099-04-01",
                "start_time": "15:00",
                "location": "Illini Union (1401 W Green St, Urbana, IL 61801)",
                "is_online": False,
            },
        },
        source_email_link="https://mail.google.com/mail/u/0/#all/thread-123",
    )

    assert len(sent_messages) == 1
    assert sent_messages[0].startswith("⏰ lunch meeting w/ aryan at illini union!")


@pytest.mark.anyio
async def test_send_summary_requires_configured_channel(monkeypatch):
    monkeypatch.setattr("messenger.Config.telegram_token", "")
    monkeypatch.setattr("messenger.Config.telegram_chat_id", "")
    monkeypatch.setattr("messenger.Config.imessage_enabled", False)

    with pytest.raises(MessagingDeliveryError):
        await send_summary({"summary": "Hello", "urgency": "none", "can_wait": True})


@pytest.mark.anyio
async def test_send_text_message_requires_configured_channel(monkeypatch):
    monkeypatch.setattr("messenger.Config.telegram_token", "")
    monkeypatch.setattr("messenger.Config.telegram_chat_id", "")
    monkeypatch.setattr("messenger.Config.imessage_enabled", False)

    with pytest.raises(MessagingDeliveryError):
        await send_text_message("hello")
