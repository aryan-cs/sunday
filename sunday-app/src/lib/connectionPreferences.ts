import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const CONNECTION_PREFERENCES_KEY = "sunday.connection.preferences";
const DEFAULT_HOSTED_BACKEND_URL = "https://sundayramp-production.up.railway.app";
const DEFAULT_BACKEND_TARGET: BackendTarget = "Hosted";

function normalizeHostedBackendUrl(value: string | undefined) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed || trimmed.includes(".vercel.app")) {
    return DEFAULT_HOSTED_BACKEND_URL;
  }
  return trimmed;
}

export type BackendTarget = "Self-hosted" | "Hosted";

export type ConnectionPreferences = {
  connectedAgent: string;
  backendTarget: BackendTarget;
  vercelBaseUrl: string;
};

const DEFAULT_CONNECTION_PREFERENCES: ConnectionPreferences = {
  connectedAgent: "Ollama",
  backendTarget: DEFAULT_BACKEND_TARGET,
  vercelBaseUrl: DEFAULT_HOSTED_BACKEND_URL,
};

export async function getConnectionPreferences(): Promise<ConnectionPreferences> {
  const raw = await AsyncStorage.getItem(CONNECTION_PREFERENCES_KEY);
  if (!raw) {
    return DEFAULT_CONNECTION_PREFERENCES;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ConnectionPreferences> & {
      backendTarget?: string;
    };
    const rawBackendTarget = typeof parsed.backendTarget === "string"
      ? parsed.backendTarget.trim()
      : "";
    return {
      connectedAgent:
        typeof parsed.connectedAgent === "string" && parsed.connectedAgent.trim()
          ? parsed.connectedAgent
          : DEFAULT_CONNECTION_PREFERENCES.connectedAgent,
      backendTarget:
        rawBackendTarget === "Hosted" || rawBackendTarget === "Vercel"
          ? "Hosted"
          : DEFAULT_CONNECTION_PREFERENCES.backendTarget,
      vercelBaseUrl: normalizeHostedBackendUrl(parsed.vercelBaseUrl),
    };
  } catch {
    return DEFAULT_CONNECTION_PREFERENCES;
  }
}

export async function saveConnectionPreferences(
  nextPreferences: Partial<ConnectionPreferences>,
): Promise<ConnectionPreferences> {
  const current = await getConnectionPreferences();
  const merged: ConnectionPreferences = {
    ...current,
    ...nextPreferences,
    connectedAgent:
      typeof nextPreferences.connectedAgent === "string"
        ? nextPreferences.connectedAgent
        : current.connectedAgent,
    vercelBaseUrl: normalizeHostedBackendUrl(nextPreferences.vercelBaseUrl ?? current.vercelBaseUrl),
  };
  await AsyncStorage.setItem(CONNECTION_PREFERENCES_KEY, JSON.stringify(merged));
  return merged;
}
