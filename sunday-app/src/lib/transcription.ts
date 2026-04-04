import { fetchApi } from "./api";

const API_TOKEN = (process.env.EXPO_PUBLIC_API_TOKEN ?? "").trim();
const TRANSCRIPTION_REQUEST_TIMEOUT_MS = 45000;

type TranscriptionResponse = {
  text?: string;
  summary?: string;
  detail?: string;
};

export type TranscriptionResult = {
  text: string;
  summary: string;
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
  return "audio/m4a";
}

export async function uploadRecordingForTranscription(uri: string): Promise<TranscriptionResult> {
  const fileName = uri.split("/").pop() ?? "recording.m4a";
  const formData = new FormData();
  const file: ReactNativeUploadFile = {
    uri,
    name: fileName,
    type: getAudioMimeType(fileName.toLowerCase()),
  };
  formData.append("file", file as unknown as Blob);

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

  return { text, summary };
}
