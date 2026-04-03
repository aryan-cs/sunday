import { API_BASE_URL, API_TOKEN } from "./config";
import { CalendarEvent } from "./types";

const headers = (): HeadersInit => ({
  "Content-Type": "application/json",
  ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
});

export async function fetchEvents(): Promise<CalendarEvent[]> {
  const res = await fetch(`${API_BASE_URL}/api/events`, { headers: headers() });
  if (!res.ok) throw new Error(`Events fetch failed: ${res.status}`);
  const data = await res.json();
  return data.events as CalendarEvent[];
}

export async function postLocation(
  latitude: number,
  longitude: number,
  accuracy: number | null
): Promise<void> {
  await fetch(`${API_BASE_URL}/api/location`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ latitude, longitude, accuracy }),
  });
}

export async function registerPushToken(token: string): Promise<void> {
  await fetch(`${API_BASE_URL}/api/register-push-token`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ token }),
  });
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/health`, { headers: headers() });
    return res.ok;
  } catch {
    return false;
  }
}
