/**
 * recorder.ts — native (iOS/Android) implementation using expo-audio.
 * The Metro bundler automatically uses recorder.web.ts on web.
 */
import {
  IOSOutputFormat,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { Platform } from "react-native";

export type RecorderState = {
  isRecording: boolean;
  durationMillis: number;
};

export type StopResult =
  | { uri: string; blob?: never; durationMillis: number }
  | { uri?: never; blob: Blob; durationMillis: number };

export type Recorder = {
  state: RecorderState;
  start: () => Promise<void>;
  stop: () => Promise<StopResult>;
};

const IOS_TRANSCRIPTION_RECORDING_PRESET = {
  ...RecordingPresets.HIGH_QUALITY,
  extension: ".wav",
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 256000,
  ios: {
    ...RecordingPresets.HIGH_QUALITY.ios,
    extension: ".wav",
    outputFormat: IOSOutputFormat.LINEARPCM,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
};

export function useRecorder(): Recorder {
  const recorder = useAudioRecorder(
    Platform.OS === "ios" ? IOS_TRANSCRIPTION_RECORDING_PRESET : RecordingPresets.HIGH_QUALITY,
  );
  const recorderState = useAudioRecorderState(recorder, 200);

  const start = async () => {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      throw new Error("Microphone permission denied.");
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
  };

  const stop = async (): Promise<StopResult> => {
    const liveStatus = recorder.getStatus();
    const durationMillis = Math.max(
      recorderState.durationMillis ?? 0,
      liveStatus.durationMillis ?? 0,
    );
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false });
    const finalStatus = recorder.getStatus();
    const uri = recorder.uri ?? finalStatus.url ?? recorderState.url;
    if (!uri) {
      throw new Error("No recording file was produced.");
    }
    return {
      uri,
      durationMillis: Math.max(durationMillis, finalStatus.durationMillis ?? 0),
    };
  };

  return {
    state: {
      isRecording: recorderState.isRecording,
      durationMillis: recorderState.durationMillis ?? 0,
    },
    start,
    stop,
  };
}
