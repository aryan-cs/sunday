import { ActionItem } from "./alertEntries";
import { fetchApi } from "./api";

const API_TOKEN = (process.env.EXPO_PUBLIC_API_TOKEN ?? "").trim();
const TRANSCRIPTION_REQUEST_TIMEOUT_MS = 60000;

type TranscriptionResponse = {
  text?: string;
  summary?: string;
  detail?: string;
  actions?: {
    calendar_events?: Array<{
      title: string;
      date: string | null;
      start_time: string | null;
      end_time: string | null;
      location: string | null;
      is_online: boolean | null;
      description: string | null;
      executed: boolean;
      conflict: boolean;
      conflict_with: string | null;
    }>;
    reminders?: Array<{
      task: string;
      deadline: string | null;
      priority: string;
      executed: boolean;
    }>;
    social_insights?: Array<{
      person: string;
      insight: string;
      category: string;
    }>;
    preparation_items?: Array<{
      topic: string;
      suggestion: string;
    }>;
    research_items?: Array<{
      title: string;
      url: string;
      snippet: string | null;
      source: string;
    }>;
    messages_to_send?: Array<{
      recipient_name: string;
      message: string;
      phone: string | null;
      executed: boolean;
    }>;
  } | null;
};

export type TranscriptionResult = {
  text: string;
  summary: string;
  actions?: ActionItem[];
};

type ReactNativeUploadFile = {
  uri: string;
  name: string;
  type: string;
};

function getAudioMimeType(fileName: string) {
  if (fileName.endsWith(".wav")) {
    return "audio/wav";
  }
  if (fileName.endsWith(".mp3")) {
    return "audio/mpeg";
  }
  if (fileName.endsWith(".webm")) {
    return "audio/webm";
  }
  if (fileName.endsWith(".ogg")) {
    return "audio/ogg";
  }
  return "audio/m4a";
}

function getBlobExtension(blob: Blob) {
  const mimeType = blob.type.toLowerCase();
  if (mimeType.includes("ogg")) {
    return "ogg";
  }
  if (mimeType.includes("mp4") || mimeType.includes("mpeg") || mimeType.includes("aac")) {
    return "m4a";
  }
  return "webm";
}

function parseActions(raw: TranscriptionResponse["actions"]): ActionItem[] | undefined {
  if (!raw) return undefined;

  const items: ActionItem[] = [];

  for (const ev of raw.calendar_events ?? []) {
    items.push({ type: "calendar_event", ...ev });
  }
  for (const r of raw.reminders ?? []) {
    items.push({ type: "reminder", ...r });
  }
  for (const s of raw.social_insights ?? []) {
    items.push({ type: "social_insight", ...s });
  }
  for (const p of raw.preparation_items ?? []) {
    items.push({ type: "preparation", ...p });
  }
  for (const r of raw.research_items ?? []) {
    items.push({ type: "research", ...r });
  }
  for (const m of raw.messages_to_send ?? []) {
    items.push({ type: "send_message", ...m });
  }

  return items.length > 0 ? items : undefined;
}

export async function uploadRecordingForTranscription(uri: string): Promise<TranscriptionResult> {
  const fileName = uri.split("/").pop() ?? "recording.m4a";
  const formData = new FormData();
  const file: ReactNativeUploadFile = {
    uri,
    name: fileName,
    type: getAudioMimeType(fileName.toLowerCase()),
  };
  formData.append("file", file as any, fileName);

  const headers: Record<string, string> = {};
  if (API_TOKEN) {
    headers.authorization = `Bearer ${API_TOKEN}`;
  }

  const response = await fetchApi("/api/transcribe", {
    method: "POST",
    headers,
    body: formData,
  }, {
    timeoutMs: TRANSCRIPTION_REQUEST_TIMEOUT_MS,
  });

  const payload = (await response.json().catch(() => ({}))) as TranscriptionResponse;
  if (!response.ok) {
    throw new Error(payload.detail || `Transcription failed with status ${response.status}.`);
  }

  const text = payload.text?.trim();
  if (!text) {
    throw new Error("Backend returned an empty transcript.");
  }

  const summary = payload.summary?.trim() || "Untitled Voice Note";
  const actions = parseActions(payload.actions);

  return { text, summary, actions };
}

export async function uploadBlobForTranscription(blob: Blob): Promise<TranscriptionResult> {
  const ext = getBlobExtension(blob);
  const formData = new FormData();
  formData.append("file", blob, `recording.${ext}`);

  const headers: Record<string, string> = {};
  if (API_TOKEN) {
    headers.authorization = `Bearer ${API_TOKEN}`;
  }

  const response = await fetchApi(
    "/api/transcribe",
    { method: "POST", headers, body: formData },
    { timeoutMs: TRANSCRIPTION_REQUEST_TIMEOUT_MS },
  );

  const payload = (await response.json().catch(() => ({}))) as TranscriptionResponse;
  if (!response.ok) {
    throw new Error(payload.detail || `Transcription failed with status ${response.status}.`);
  }

  const text = payload.text?.trim();
  if (!text) {
    throw new Error("Backend returned an empty transcript.");
  }

  return {
    text,
    summary: payload.summary?.trim() || "Untitled Voice Note",
    actions: parseActions(payload.actions),
  };
}
