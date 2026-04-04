import { fetchApi } from "./api";

const API_TOKEN = (process.env.EXPO_PUBLIC_API_TOKEN ?? "").trim();

export type AppSettingsValues = Record<string, string | boolean>;

export type AppSettingsResponse = {
  settings: AppSettingsValues;
  errors: string[];
  warnings: string[];
};

export type ReverseGeocodeResponse = {
  label: string;
  latitude: number;
  longitude: number;
};

function buildHeaders() {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (API_TOKEN) {
    headers.authorization = `Bearer ${API_TOKEN}`;
  }
  return headers;
}

async function parseResponse(response: Response): Promise<AppSettingsResponse> {
  const payload = (await response.json().catch(() => ({}))) as Partial<AppSettingsResponse> & {
    detail?: string;
  };
  if (!response.ok) {
    throw new Error(payload.detail || `Request failed with status ${response.status}.`);
  }
  return {
    settings: payload.settings ?? {},
    errors: payload.errors ?? [],
    warnings: payload.warnings ?? [],
  };
}

export async function fetchAppSettings(): Promise<AppSettingsResponse> {
  const response = await fetchApi("/api/settings", {
    method: "GET",
    headers: buildHeaders(),
  });

  return parseResponse(response);
}

export async function saveAppSettings(settings: AppSettingsValues): Promise<AppSettingsResponse> {
  const response = await fetchApi("/api/settings", {
    method: "PUT",
    headers: buildHeaders(),
    body: JSON.stringify({ settings }),
  });

  return parseResponse(response);
}

export async function reverseGeocodeLocation(
  latitude: number,
  longitude: number,
): Promise<ReverseGeocodeResponse> {
  const response = await fetchApi("/api/settings/reverse-geocode", {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({ latitude, longitude }),
  });

  const payload = (await response.json().catch(() => ({}))) as Partial<ReverseGeocodeResponse> & {
    detail?: string;
  };
  if (!response.ok) {
    throw new Error(payload.detail || `Request failed with status ${response.status}.`);
  }

  return {
    label: payload.label ?? `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`,
    latitude: payload.latitude ?? latitude,
    longitude: payload.longitude ?? longitude,
  };
}
