import AsyncStorage from "@react-native-async-storage/async-storage";

const CONNECTION_PREFERENCES_KEY = "sunday.connection.preferences";

export type BackendTarget = "Self-hosted" | "Vercel";

export type ConnectionPreferences = {
  connectedAgent: string;
  backendTarget: BackendTarget;
  vercelBaseUrl: string;
};

const DEFAULT_CONNECTION_PREFERENCES: ConnectionPreferences = {
  connectedAgent: "Ollama",
  backendTarget: "Self-hosted",
  vercelBaseUrl: "",
};

export async function getConnectionPreferences(): Promise<ConnectionPreferences> {
  const raw = await AsyncStorage.getItem(CONNECTION_PREFERENCES_KEY);
  if (!raw) {
    return DEFAULT_CONNECTION_PREFERENCES;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ConnectionPreferences>;
    return {
      connectedAgent:
        typeof parsed.connectedAgent === "string" && parsed.connectedAgent.trim()
          ? parsed.connectedAgent
          : DEFAULT_CONNECTION_PREFERENCES.connectedAgent,
      backendTarget:
        parsed.backendTarget === "Vercel" ? "Vercel" : DEFAULT_CONNECTION_PREFERENCES.backendTarget,
      vercelBaseUrl:
        typeof parsed.vercelBaseUrl === "string" ? parsed.vercelBaseUrl.trim() : "",
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
    vercelBaseUrl:
      typeof nextPreferences.vercelBaseUrl === "string"
        ? nextPreferences.vercelBaseUrl.trim()
        : current.vercelBaseUrl,
  };
  await AsyncStorage.setItem(CONNECTION_PREFERENCES_KEY, JSON.stringify(merged));
  return merged;
}
