import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { AlertEntry } from "./alertEntries";

const ALERT_ENTRIES_KEY = "sunday.alertEntries.v1";
const PENDING_RELOAD_MESSAGE = "The app reloaded before transcription finished.";

// ── File system (native only) ─────────────────────────────────────────────────

function getFileExtension(uri: string) {
  const path = uri.split("?")[0] ?? uri;
  const lastDot = path.lastIndexOf(".");
  return lastDot === -1 ? ".m4a" : path.slice(lastDot);
}

async function nativePersistRecordingFile(sourceUri: string): Promise<string> {
  const { Directory, File, Paths } = await import("expo-file-system");
  const recordingsDir = new Directory(Paths.document, "recordings");
  if (!recordingsDir.exists) {
    recordingsDir.create({ idempotent: true, intermediates: true });
  }
  const dest = new File(
    recordingsDir,
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${getFileExtension(sourceUri)}`,
  );
  new File(sourceUri).copy(dest);
  return dest.uri;
}

async function nativeDeleteStoredAlertAudio(audioUri: string): Promise<void> {
  const { File } = await import("expo-file-system");
  const file = new File(audioUri);
  if (file.exists) file.delete();
}

// ── Public API ────────────────────────────────────────────────────────────────

function normalizeLoadedEntry(entry: AlertEntry): AlertEntry {
  if (entry.status !== "pending") return entry;
  return {
    ...entry,
    status: "failed",
    summary: "Transcription interrupted",
    transcript: entry.transcript.trim() || PENDING_RELOAD_MESSAGE,
  };
}

function parseStoredEntry(value: unknown): AlertEntry | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AlertEntry>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.summary !== "string" ||
    typeof candidate.transcript !== "string" ||
    typeof candidate.createdAt !== "string" ||
    (candidate.status !== "pending" &&
      candidate.status !== "complete" &&
      candidate.status !== "failed")
  ) {
    return null;
  }
  return {
    id: candidate.id,
    summary: candidate.summary,
    transcript: candidate.transcript,
    createdAt: candidate.createdAt,
    status: candidate.status,
    audioUri: typeof candidate.audioUri === "string" ? candidate.audioUri : null,
    actions: Array.isArray(candidate.actions) ? candidate.actions : undefined,
  };
}

export async function loadStoredAlertEntries(): Promise<AlertEntry[]> {
  const raw = await AsyncStorage.getItem(ALERT_ENTRIES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseStoredEntry)
      .filter((e): e is AlertEntry => Boolean(e))
      .map(normalizeLoadedEntry);
  } catch {
    return [];
  }
}

export async function saveStoredAlertEntries(entries: AlertEntry[]): Promise<void> {
  await AsyncStorage.setItem(ALERT_ENTRIES_KEY, JSON.stringify(entries));
}

export async function persistRecordingFile(sourceUri: string): Promise<string> {
  if (Platform.OS === "web") return sourceUri; // web uses blob URLs directly
  return nativePersistRecordingFile(sourceUri);
}

export async function deleteStoredAlertAudio(audioUri?: string | null): Promise<void> {
  if (!audioUri || Platform.OS === "web") return;
  await nativeDeleteStoredAlertAudio(audioUri);
}
