from __future__ import annotations

import pytest

from errors import MessagingDeliveryError
from messenger import send_summary


@pytest.mark.anyio
async def test_send_summary_requires_configured_channel(monkeypatch):
    monkeypatch.setattr("messenger.Config.telegram_token", "")
    monkeypatch.setattr("messenger.Config.telegram_chat_id", "")
    monkeypatch.setattr("messenger.Config.imessage_enabled", False)

    with pytest.raises(MessagingDeliveryError):
        await send_summary({"summary": "Hello", "urgency": "none", "can_wait": True})
