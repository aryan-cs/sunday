import { fetchApi } from "./api";

const API_TOKEN = (process.env.EXPO_PUBLIC_API_TOKEN ?? "").trim();
const SETTINGS_REQUEST_TIMEOUT_MS = 8000;

export type AppSettingsValues = Record<string, string | boolean>;

export type AppSettingsResponse = {
  settings: AppSettingsValues;
  errors: string[];
  warnings: string[];
  metadata: Record<string, string>;
  modelOptions: {
    transcription: string[];
    summarization: string[];
  };
};

export type ReverseGeocodeResponse = {
  label: string;
  latitude: number;
  longitude: number;
};

export type GeocodeSearchResponse = {
  label: string;
  latitude: number;
  longitude: number;
};

function buildHeaders(includeJsonContentType = true) {
  const headers: Record<string, string> = {
  };
  if (includeJsonContentType) {
    headers["Content-Type"] = "application/json";
  }
  if (API_TOKEN) {
    headers.authorization = `Bearer ${API_TOKEN}`;
  }
  return headers;
}

async function parseResponse(response: Response): Promise<AppSettingsResponse> {
  const payload = (await response.json().catch(() => ({}))) as Partial<AppSettingsResponse> & {
    detail?: string;
    model_options?: Partial<AppSettingsResponse["modelOptions"]>;
  };
  if (!response.ok) {
    throw new Error(payload.detail || `Request failed with status ${response.status}.`);
  }
  return {
    settings: payload.settings ?? {},
    errors: payload.errors ?? [],
    warnings: payload.warnings ?? [],
    metadata: payload.metadata ?? {},
    modelOptions: {
      transcription: payload.modelOptions?.transcription ?? payload.model_options?.transcription ?? [],
      summarization: payload.modelOptions?.summarization ?? payload.model_options?.summarization ?? [],
    },
  };
}

export async function fetchAppSettings(): Promise<AppSettingsResponse> {
  const response = await fetchApi("/api/settings", {
    method: "GET",
    headers: buildHeaders(false),
  }, {
    timeoutMs: SETTINGS_REQUEST_TIMEOUT_MS,
  });

  return parseResponse(response);
}

export async function saveAppSettings(settings: AppSettingsValues): Promise<AppSettingsResponse> {
  const response = await fetchApi("/api/settings", {
    method: "PUT",
    headers: buildHeaders(),
    body: JSON.stringify({ settings }),
  }, {
    timeoutMs: SETTINGS_REQUEST_TIMEOUT_MS,
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
  }, {
    timeoutMs: SETTINGS_REQUEST_TIMEOUT_MS,
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

export async function geocodeLocationSearch(query: string): Promise<GeocodeSearchResponse> {
  const response = await fetchApi("/api/settings/geocode", {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({ query }),
  }, {
    timeoutMs: SETTINGS_REQUEST_TIMEOUT_MS,
  });

  const payload = (await response.json().catch(() => ({}))) as Partial<GeocodeSearchResponse> & {
    detail?: string;
  };
  if (!response.ok) {
    throw new Error(payload.detail || `Request failed with status ${response.status}.`);
  }

  return {
    label: payload.label ?? query.trim(),
    latitude: payload.latitude ?? 0,
    longitude: payload.longitude ?? 0,
  };
}
