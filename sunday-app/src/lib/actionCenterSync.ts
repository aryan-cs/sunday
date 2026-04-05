import { AlertEntry } from "./alertEntries";
import { fetchApi } from "./api";

const API_TOKEN = (process.env.EXPO_PUBLIC_API_TOKEN ?? "").trim();
const ACTION_CENTER_TIMEOUT_MS = 20000;

type ActionCenterPayload = {
  entries?: AlertEntry[];
};

function normalizeEntry(raw: AlertEntry): AlertEntry | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  if (
    typeof raw.id !== "string" ||
    typeof raw.summary !== "string" ||
    typeof raw.transcript !== "string" ||
    typeof raw.createdAt !== "string" ||
    (raw.status !== "pending" && raw.status !== "complete" && raw.status !== "failed")
  ) {
    return null;
  }

  return {
    id: raw.id,
    summary: raw.summary,
    transcript: raw.transcript,
    createdAt: raw.createdAt,
    status: raw.status,
    audioUri: typeof raw.audioUri === "string" ? raw.audioUri : null,
    actions: Array.isArray(raw.actions) ? raw.actions : undefined,
  };
}

export async function fetchActionCenterEntries(limit = 100): Promise<AlertEntry[]> {
  const headers: Record<string, string> = {};
  if (API_TOKEN) {
    headers.authorization = `Bearer ${API_TOKEN}`;
  }

  const response = await fetchApi(`/api/action-center?limit=${Math.max(1, Math.min(limit, 300))}`, {
    method: "GET",
    headers,
  }, {
    timeoutMs: ACTION_CENTER_TIMEOUT_MS,
  });
  if (!response.ok) {
    throw new Error(`Action center sync failed with status ${response.status}.`);
  }

  const payload = (await response.json().catch(() => ({}))) as ActionCenterPayload;
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  return entries
    .map(normalizeEntry)
    .filter((entry): entry is AlertEntry => Boolean(entry));
}
