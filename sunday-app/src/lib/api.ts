const PRIMARY_API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? "")
  .trim()
  .replace(/\/+$/, "");
const FALLBACK_API_BASE_URLS = (process.env.EXPO_PUBLIC_API_FALLBACK_URLS ?? "")
  .split(",")
  .map((value: string) => value.trim().replace(/\/+$/, ""))
  .filter(Boolean);
const API_DISCOVERY_TIMEOUT_MS = 2500;

let resolvedApiBaseUrl: string | null = null;
let resolutionPromise: Promise<string> | null = null;
let announcedApiBaseUrl: string | null = null;

function buildApiBaseUrlCandidates(exclude: string[] = []) {
  const unique = new Set<string>();
  for (const candidate of [PRIMARY_API_BASE_URL, ...FALLBACK_API_BASE_URLS]) {
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

async function probeApiBaseUrl(baseUrl: string) {
  const response = await fetchWithOptionalTimeout(
    `${baseUrl}/health`,
    { method: "GET" },
    API_DISCOVERY_TIMEOUT_MS,
  );
  return response.ok;
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

export async function resolveApiBaseUrl(exclude: string[] = []): Promise<string> {
  if (resolvedApiBaseUrl && !exclude.includes(resolvedApiBaseUrl)) {
    announceResolvedApiBaseUrl(resolvedApiBaseUrl);
    return resolvedApiBaseUrl;
  }

  const candidates = buildApiBaseUrlCandidates(exclude);
  if (!candidates.length) {
    throw new Error("No Sunday backend URLs are configured.");
  }

  if (!exclude.length && resolutionPromise) {
    return resolutionPromise;
  }

  const resolver = (async () => {
    let lastError: unknown = null;

    for (const candidate of candidates) {
      try {
        if (!(await probeApiBaseUrl(candidate))) {
          lastError = new Error(`Health check failed for ${candidate}.`);
          continue;
        }

        if (!exclude.length) {
          resolvedApiBaseUrl = candidate;
        }
        announceResolvedApiBaseUrl(candidate);
        return candidate;
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError instanceof Error && lastError.name === "AbortError") {
      throw new Error("Sunday backend discovery timed out.");
    }
    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new Error("Could not reach the Sunday backend.");
  })();

  if (!exclude.length) {
    resolutionPromise = resolver.finally(() => {
      resolutionPromise = null;
    });
    return resolutionPromise;
  }

  return resolver;
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
  const maxAttempts = Math.max(1, buildApiBaseUrlCandidates().length);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const baseUrl = await resolveApiBaseUrl(attemptedBaseUrls);
    attemptedBaseUrls.push(baseUrl);

    try {
      return await fetchWithOptionalTimeout(`${baseUrl}${path}`, init, options.timeoutMs);
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

  if (lastError instanceof Error && lastError.name === "AbortError") {
    throw new Error("Sunday backend request timed out.");
  }
  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("Could not reach the Sunday backend.");
}
