import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { AlertEntry } from "./alertEntries";

const ALERT_ENTRIES_KEY = "sunday.alertEntries.v1";
const PENDING_RELOAD_MESSAGE = "The app reloaded before transcription finished.";
const RECORDING_FILE_READY_TIMEOUT_MS = 2500;
const RECORDING_FILE_READY_POLL_MS = 120;
const MIN_READY_RECORDING_BYTES = 1;

function normalizeLoadedAudioUri(audioUri?: string | null) {
  if (typeof audioUri !== "string") {
    return null;
  }

  if (Platform.OS !== "web") {
    return audioUri;
  }

  // Blob/object URLs from previous page loads are no longer valid after a reload.
  if (audioUri.startsWith("blob:") || audioUri.startsWith("web-")) {
    return null;
  }

  return audioUri;
}

// ── File system (native only) ─────────────────────────────────────────────────

function getFileExtension(uri: string) {
  const path = uri.split("?")[0] ?? uri;
  const lastDot = path.lastIndexOf(".");
  return lastDot === -1 ? ".m4a" : path.slice(lastDot);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForNativeRecordingFile(sourceUri: string) {
  const { File } = await import("expo-file-system");
  const deadline = Date.now() + RECORDING_FILE_READY_TIMEOUT_MS;
  let previousSize = -1;
  let stableCount = 0;

  while (Date.now() < deadline) {
    const sourceFile = new File(sourceUri);
    const size = sourceFile.size;
    if (sourceFile.exists && size > MIN_READY_RECORDING_BYTES) {
      stableCount = size === previousSize ? stableCount + 1 : 1;
      previousSize = size;
      if (stableCount >= 2) {
        return sourceFile;
      }
    } else {
      previousSize = size;
      stableCount = 0;
    }
    await wait(RECORDING_FILE_READY_POLL_MS);
  }

  const sourceFile = new File(sourceUri);
  if (sourceFile.exists && sourceFile.size > MIN_READY_RECORDING_BYTES) {
    return sourceFile;
  }
  throw new Error("Recording file was not ready. Please try again.");
}

async function nativePersistRecordingFile(sourceUri: string): Promise<string> {
  const { Directory, File, Paths } = await import("expo-file-system");
  const sourceFile = await waitForNativeRecordingFile(sourceUri);
  const recordingsDir = new Directory(Paths.document, "recordings");
  if (!recordingsDir.exists) {
    recordingsDir.create({ idempotent: true, intermediates: true });
  }
  const dest = new File(
    recordingsDir,
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${getFileExtension(sourceUri)}`,
  );
  sourceFile.copy(dest);
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
    audioUri: normalizeLoadedAudioUri(entry.audioUri),
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
    audioUri: normalizeLoadedAudioUri(candidate.audioUri),
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
  if (!audioUri) return;
  if (Platform.OS === "web") {
    if (audioUri.startsWith("blob:") && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(audioUri);
    }
    return;
  }
  await nativeDeleteStoredAlertAudio(audioUri);
}
