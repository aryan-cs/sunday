from __future__ import annotations

import pytest

from errors import MessagingDeliveryError
from messenger import format_summary, send_summary


def test_format_summary_for_event_is_informal_and_includes_email_link(monkeypatch):
    monkeypatch.setattr("messenger.Config.timezone", "America/Chicago")

    message = format_summary(
        parsed_email={
            "has_event": True,
            "summary": "Meet Aryan for lunch at the Union at 3 PM.",
            "event": {
                "date": "2099-04-01",
                "start_time": "15:00",
                "location": "1401 W Green St, Urbana, IL 61801",
                "is_online": False,
            },
        },
        travel_info={"departure_time": "2:35 PM"},
        source_email_link="https://mail.google.com/mail/u/0/#all/thread-123",
    )

    assert "reminder: meet aryan for lunch at the union at 3pm!" in message
    assert "location: 1401 W Green St, Urbana, IL 61801" in message
    assert "time: Apr 1 at 3:00 p.m." in message
    assert "leave by: 2:35 p.m." in message
    assert "original email:" not in message


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
    monkeypatch.setattr("messenger.TelegramMessenger.send", fake_send)

    await send_summary(
        parsed_email={
            "has_event": True,
            "summary": "Meet Aryan for lunch at the Union at 3 PM.",
            "event": {
                "date": "2099-04-01",
                "start_time": "15:00",
                "location": "Illini Union (1401 W Green St, Urbana, IL 61801)",
                "is_online": False,
            },
        },
        source_email_link="https://mail.google.com/mail/u/0/#all/thread-123",
    )

    assert len(sent_messages) == 2
    assert sent_messages[0].startswith("reminder: meet aryan for lunch at the union at 3pm!")
    assert sent_messages[1] == "https://mail.google.com/mail/u/0/#all/thread-123"


@pytest.mark.anyio
async def test_send_summary_requires_configured_channel(monkeypatch):
    monkeypatch.setattr("messenger.Config.telegram_token", "")
    monkeypatch.setattr("messenger.Config.telegram_chat_id", "")
    monkeypatch.setattr("messenger.Config.imessage_enabled", False)

    with pytest.raises(MessagingDeliveryError):
        await send_summary({"summary": "Hello", "urgency": "none", "can_wait": True})
