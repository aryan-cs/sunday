from __future__ import annotations

from backend.contacts_store import (
    build_contact_lookup,
    find_contacts_in_text,
    resolve_contact_for_recipient,
)


def test_find_contacts_in_text_matches_normalized_full_and_first_names():
    contacts = [
        {"id": "1", "name": "Ananya Jajoo", "phone": "+12175550111"},
        {"id": "2", "name": "Sarah Johnson", "phone": "+12175550222"},
    ]

    matched = find_contacts_in_text(
        "I'm running late to meet Sarah at the library.",
        contacts=contacts,
    )

    assert [contact["name"] for contact in matched] == ["Sarah Johnson"]


def test_resolve_contact_for_recipient_uses_full_name_and_first_name():
    contacts = [
        {"id": "1", "name": "Ananya Jajoo", "phone": "+12175550111"},
        {"id": "2", "name": "Sarah Johnson", "phone": "+12175550222"},
    ]

    full = resolve_contact_for_recipient("Ananya Jajoo", contacts)
    first = resolve_contact_for_recipient("Sarah", contacts)

    assert full and full["phone"] == "+12175550111"
    assert first and first["phone"] == "+12175550222"


def test_build_contact_lookup_does_not_override_existing_first_name_mapping():
    contacts = [
        {"id": "1", "name": "Sam Carter", "phone": "+12175550111"},
        {"id": "2", "name": "Sam Wilson", "phone": "+12175550222"},
    ]

    lookup = build_contact_lookup(contacts)

    assert lookup["sam"]["phone"] == "+12175550111"
