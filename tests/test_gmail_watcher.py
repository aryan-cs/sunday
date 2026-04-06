from __future__ import annotations

from backend.gmail_watcher import GmailWatcher


class _FakeRequest:
    def __init__(self, payload):
        self.payload = payload

    def execute(self):
        return self.payload


class _FakeMessages:
    def __init__(self, list_payloads, get_payloads):
        self._list_payloads = list_payloads
        self._get_payloads = get_payloads
        self.get_calls: list[str] = []
        self.list_calls: list[dict] = []

    def list(self, **kwargs):
        self.list_calls.append(kwargs)
        del kwargs
        return _FakeRequest(self._list_payloads.pop(0))

    def get(self, userId, id, format):
        del userId, format
        self.get_calls.append(id)
        return _FakeRequest(self._get_payloads[id])


class _FakeUsers:
    def __init__(self, messages):
        self._messages = messages

    def messages(self):
        return self._messages


class _FakeService:
    def __init__(self, messages):
        self._users = _FakeUsers(messages)

    def users(self):
        return self._users


def _gmail_payload(message_id: str, subject: str, internal_date: int) -> dict:
    return {
        "id": message_id,
        "internalDate": str(internal_date),
        "payload": {
            "headers": [
                {"name": "From", "value": "sender@example.com"},
                {"name": "Subject", "value": subject},
            ],
            "body": {"data": ""},
        },
        "snippet": subject,
    }


def test_get_new_emails_only_returns_messages_received_after_startup():
    watcher = object.__new__(GmailWatcher)
    watcher._seen_ids = set()
    watcher._processed_ids = set()
    watcher._startup_cutoff_ms = 1000

    messages = _FakeMessages(
        list_payloads=[
            {"messages": [{"id": "new-1"}, {"id": "old-1"}]},
        ],
        get_payloads={
            "new-1": _gmail_payload("new-1", "Fresh email", 2000),
            "old-1": _gmail_payload("old-1", "Old email", 900),
        },
    )
    watcher.service = _FakeService(messages)

    emails = watcher.get_new_emails(max_results=10)

    assert [email["id"] for email in emails] == ["new-1"]
    assert messages.get_calls == ["new-1", "old-1"]


def test_get_new_emails_can_pick_up_a_new_message_even_if_it_is_not_unread():
    watcher = object.__new__(GmailWatcher)
    watcher._seen_ids = set()
    watcher._processed_ids = set()
    watcher._startup_cutoff_ms = 1000

    messages = _FakeMessages(
        list_payloads=[
            {"messages": [{"id": "new-opened"}]},
        ],
        get_payloads={
            "new-opened": _gmail_payload("new-opened", "Opened email", 2000),
        },
    )
    watcher.service = _FakeService(messages)

    emails = watcher.get_new_emails(max_results=10)

    assert [email["id"] for email in emails] == ["new-opened"]


def test_list_page_normalizes_gmail_system_label_ids(monkeypatch):
    watcher = object.__new__(GmailWatcher)
    messages = _FakeMessages(
        list_payloads=[{"messages": []}],
        get_payloads={},
    )
    watcher.service = _FakeService(messages)

    monkeypatch.setattr("backend.gmail_watcher.Config.gmail_labels", ["inbox", "category_primary", "Label_123"])

    watcher._list_message_ids_page(max_results=5)

    assert messages.list_calls == [
        {
            "userId": "me",
            "labelIds": ["INBOX", "CATEGORY_PRIMARY", "Label_123"],
            "maxResults": 5,
            "pageToken": None,
        }
    ]
