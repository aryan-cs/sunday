const PRIMARY_API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? "")
  .trim()
  .replace(/\/+$/, "");
const FALLBACK_API_BASE_URLS = (process.env.EXPO_PUBLIC_API_FALLBACK_URLS ?? "")
  .split(",")
  .map((value: string) => value.trim().replace(/\/+$/, ""))
  .filter(Boolean);

let resolvedApiBaseUrl: string | null = null;
let announcedApiBaseUrl: string | null = null;

function buildApiBaseUrlCandidates(exclude: string[] = []) {
  const unique = new Set<string>();
  for (const candidate of [
    resolvedApiBaseUrl,
    PRIMARY_API_BASE_URL,
    ...FALLBACK_API_BASE_URLS,
  ]) {
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
  const attemptedBaseUrls: string[] = [];
  let lastError: unknown = null;
  const candidates = buildApiBaseUrlCandidates();

  if (!candidates.length) {
    throw new Error("No Sunday backend URLs are configured.");
  }

  for (const baseUrl of candidates) {
    attemptedBaseUrls.push(baseUrl);

    try {
      const response = await fetchWithOptionalTimeout(`${baseUrl}${path}`, init, options.timeoutMs);
      resolvedApiBaseUrl = baseUrl;
      announceResolvedApiBaseUrl(baseUrl);
      return response;
    } catch (error) {
      lastError = error;
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
