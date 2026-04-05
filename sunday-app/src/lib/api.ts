import { getConnectionPreferences } from "./connectionPreferences";

const PRIMARY_API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? "")
  .trim()
  .replace(/\/+$/, "");
const FALLBACK_API_BASE_URLS = (process.env.EXPO_PUBLIC_API_FALLBACK_URLS ?? "")
  .split(",")
  .map((value: string) => value.trim().replace(/\/+$/, ""))
  .filter(Boolean);

let resolvedApiBaseUrl: string | null = null;
let announcedApiBaseUrl: string | null = null;

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function buildApiBaseUrlCandidates(preferredBaseUrl: string | null, exclude: string[] = []) {
  const unique = new Set<string>();
  const orderedCandidates = preferredBaseUrl
    ? [preferredBaseUrl, resolvedApiBaseUrl, PRIMARY_API_BASE_URL, ...FALLBACK_API_BASE_URLS]
    : [PRIMARY_API_BASE_URL, ...FALLBACK_API_BASE_URLS, resolvedApiBaseUrl];
  for (const candidate of orderedCandidates) {
    if (!candidate || exclude.includes(candidate)) {
      continue;
    }
    unique.add(candidate);
  }
  return [...unique];
}

async function fetchWithOptionalTimeout(
  input: string,
  init: RequestInit,
  timeoutMs?: number,
) {
  if (!timeoutMs || timeoutMs <= 0) {
    return fetch(input, init);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function isRetryableNetworkError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.name === "AbortError") {
    return true;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("network request failed") ||
    message.includes("network request timed out") ||
    message.includes("the internet connection appears to be offline")
  );
}

function announceResolvedApiBaseUrl(baseUrl: string) {
  if (announcedApiBaseUrl === baseUrl) {
    return;
  }
  announcedApiBaseUrl = baseUrl;
  console.log(`[sunday] using backend ${baseUrl}`);
}

export function clearResolvedApiBaseUrl() {
  resolvedApiBaseUrl = null;
}

type FetchApiOptions = {
  timeoutMs?: number;
};

export async function fetchApi(
  path: string,
  init: RequestInit,
  options: FetchApiOptions = {},
) {
  const connectionPreferences = await getConnectionPreferences();
  const preferredBaseUrl =
    connectionPreferences.backendTarget === "Vercel" && connectionPreferences.vercelBaseUrl
      ? normalizeBaseUrl(connectionPreferences.vercelBaseUrl)
      : null;
  const method = (init.method ?? "GET").toUpperCase();
  const attemptedBaseUrls: string[] = [];
  let lastError: unknown = null;
  const candidates = buildApiBaseUrlCandidates(preferredBaseUrl);

  if (!candidates.length) {
    throw new Error("No Sunday backend URLs are configured.");
  }

  for (const baseUrl of candidates) {
    attemptedBaseUrls.push(baseUrl);
    const startedAt = Date.now();

    try {
      console.log(`[sunday] ${method} ${path} via ${baseUrl}`);
      const response = await fetchWithOptionalTimeout(`${baseUrl}${path}`, init, options.timeoutMs);
      resolvedApiBaseUrl = baseUrl;
      announceResolvedApiBaseUrl(baseUrl);
      console.log(
        `[sunday] ${method} ${path} succeeded via ${baseUrl} in ${Date.now() - startedAt}ms`,
      );
      return response;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[sunday] ${method} ${path} failed via ${baseUrl} in ${Date.now() - startedAt}ms: ${message}`,
      );
      if (!isRetryableNetworkError(error)) {
        throw error;
      }

      if (resolvedApiBaseUrl === baseUrl) {
        clearResolvedApiBaseUrl();
      }
    }
  }

  if (lastError instanceof Error) {
    if (lastError.name === "AbortError") {
      throw new Error("Sunday backend request timed out.");
    }
    throw new Error(`Could not reach the Sunday backend. ${lastError.message}`);
  }
  throw new Error("Could not reach the Sunday backend.");
}
