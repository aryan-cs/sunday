import * as Contacts from "expo-contacts";
import { fetchApi } from "./api";

const API_TOKEN = (process.env.EXPO_PUBLIC_API_TOKEN ?? "").trim();
const CONTACTS_SYNC_TIMEOUT_MS = 20000;
const MIN_CONTACTS_SYNC_INTERVAL_MS = 5 * 60 * 1000;

let lastSyncedAt = 0;

type ContactPayload = {
  id: string;
  name: string;
  phone: string;
  notes: string;
};

function choosePrimaryPhone(contact: Contacts.Contact): string {
  const phoneNumbers = contact.phoneNumbers ?? [];
  for (const candidate of phoneNumbers) {
    const number = String(candidate?.number ?? "").trim();
    if (number) {
      return number;
    }
  }
  return "";
}

function toPayloadContact(contact: Contacts.Contact, index: number): ContactPayload | null {
  const firstName = String(contact.firstName ?? "").trim();
  const lastName = String(contact.lastName ?? "").trim();
  const fullName = String(contact.name ?? `${firstName} ${lastName}`.trim()).trim();
  if (!fullName) {
    return null;
  }

  return {
    id: `${fullName.toLowerCase()}::${index}`,
    name: fullName,
    phone: choosePrimaryPhone(contact),
    notes: String((contact as Contacts.Contact & { note?: string }).note ?? "").trim(),
  };
}

export async function syncDeviceContacts(force = false): Promise<{
  ok: boolean;
  count: number;
  skipped?: "cooldown" | "permission-denied";
}> {
  const now = Date.now();
  if (!force && now - lastSyncedAt < MIN_CONTACTS_SYNC_INTERVAL_MS) {
    return { ok: true, count: 0, skipped: "cooldown" };
  }

  const permission = await Contacts.getPermissionsAsync();
  let granted = permission.granted;
  if (!granted) {
    const requested = await Contacts.requestPermissionsAsync();
    granted = requested.granted;
  }
  if (!granted) {
    return { ok: false, count: 0, skipped: "permission-denied" };
  }

  const response = await Contacts.getContactsAsync({
    fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
    sort: Contacts.SortTypes.FirstName,
  });
  const contacts: ContactPayload[] = [];
  for (const [index, contact] of (response.data ?? []).entries()) {
    const payloadContact = toPayloadContact(contact, index);
    if (payloadContact) {
      contacts.push(payloadContact);
    }
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (API_TOKEN) {
    headers.authorization = `Bearer ${API_TOKEN}`;
  }

  const syncResponse = await fetchApi(
    "/api/contacts",
    {
      method: "PUT",
      headers,
      body: JSON.stringify({ contacts }),
    },
    { timeoutMs: CONTACTS_SYNC_TIMEOUT_MS },
  );
  if (!syncResponse.ok) {
    throw new Error(`Contact sync failed with status ${syncResponse.status}.`);
  }

  lastSyncedAt = now;
  return { ok: true, count: contacts.length };
}
