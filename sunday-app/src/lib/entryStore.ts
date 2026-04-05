import AsyncStorage from "@react-native-async-storage/async-storage";
import { Directory, File, Paths } from "expo-file-system";
import { AlertEntry } from "./alertEntries";

const ALERT_ENTRIES_KEY = "sunday.alertEntries.v1";
const RECORDINGS_DIRECTORY = new Directory(Paths.document, "recordings");
const PENDING_RELOAD_MESSAGE = "The app reloaded before transcription finished.";

function ensureRecordingsDirectory() {
  if (!RECORDINGS_DIRECTORY.exists) {
    RECORDINGS_DIRECTORY.create({
      idempotent: true,
      intermediates: true,
    });
  }
}

function getFileExtension(uri: string) {
  const path = uri.split("?")[0] ?? uri;
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1) {
    return ".m4a";
  }
  return path.slice(lastDot);
}

function normalizeLoadedEntry(entry: AlertEntry): AlertEntry {
  if (entry.status !== "pending") {
    return entry;
  }

  return {
    ...entry,
    status: "failed",
    summary: "Transcription interrupted",
    transcript: entry.transcript.trim() || PENDING_RELOAD_MESSAGE,
  };
}

function parseStoredEntry(value: unknown): AlertEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

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
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map(parseStoredEntry)
      .filter((entry): entry is AlertEntry => Boolean(entry))
      .map(normalizeLoadedEntry);
  } catch {
    return [];
  }
}

export async function saveStoredAlertEntries(entries: AlertEntry[]): Promise<void> {
  await AsyncStorage.setItem(ALERT_ENTRIES_KEY, JSON.stringify(entries));
}

export async function persistRecordingFile(sourceUri: string): Promise<string> {
  ensureRecordingsDirectory();

  const sourceFile = new File(sourceUri);
  const destinationFile = new File(
    RECORDINGS_DIRECTORY,
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${getFileExtension(sourceUri)}`,
  );

  sourceFile.copy(destinationFile);
  return destinationFile.uri;
}

export async function deleteStoredAlertAudio(audioUri?: string | null): Promise<void> {
  if (!audioUri) {
    return;
  }

  const audioFile = new File(audioUri);
  if (!audioFile.exists) {
    return;
  }

  audioFile.delete();
}
