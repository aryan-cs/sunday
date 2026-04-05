import React from "react";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import {
  Animated,
  Pressable,
  StatusBar,
  StyleSheet,
  GestureResponderEvent,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ActionItem } from "../lib/alertEntries";
import { persistRecordingFile } from "../lib/entryStore";
import { uploadRecordingForTranscription } from "../lib/transcription";

const BACKGROUND = "#121212";
const DOT_SIZE = "50%";
const RECORDING = "#eb4034";
const MIN_RECORDING_DURATION_MILLIS = 700;

type HomeScreenProps = {
  onBackgroundPress?: () => void;
  onTranscriptPending?: (audioUri: string) => string;
  onTranscript?: (entryId: string, transcript: string, summary?: string, actions?: ActionItem[]) => void;
  onTranscriptError?: (entryId: string, message: string) => void;
  onRecordingChange?: (isRecording: boolean) => void;
};

export function HomeScreen({
  onBackgroundPress,
  onTranscriptPending,
  onTranscript,
  onTranscriptError,
  onRecordingChange,
}: HomeScreenProps) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);
  const [isTogglingRecording, setIsTogglingRecording] = React.useState(false);
  const recordingStartedAtRef = React.useRef<number | null>(null);
  const scale = React.useRef(new Animated.Value(1)).current;
  const isRecording = recorderState.isRecording;

  React.useEffect(() => {
    onRecordingChange?.(isRecording);
  }, [isRecording, onRecordingChange]);

  const handleBackgroundPress = React.useCallback(() => {
    onBackgroundPress?.();
  }, [onBackgroundPress]);

  const pulseDot = React.useCallback(() => {
    scale.stopAnimation(() => {
      scale.setValue(1);
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.15,
          duration: 80,
          useNativeDriver: false,
        }),
        Animated.spring(scale, {
          toValue: 1,
          speed: 50,
          bounciness: 10,
          useNativeDriver: false,
        }),
      ]).start();
    });
  }, [scale]);

  const transcribeRecording = React.useCallback(async (entryId: string, recordingUrl: string) => {
    try {
      console.log("[sunday] uploading recording for transcription");
      const result = await uploadRecordingForTranscription(recordingUrl);
      console.log("[sunday] transcript:", result.text);
      console.log("[sunday] transcript title:", result.summary);
      onTranscript?.(entryId, result.text, result.summary, result.actions);
    } catch (error) {
      console.error("[sunday] transcription failed", error);
      const message = error instanceof Error ? error.message : "Transcription failed.";
      onTranscriptError?.(entryId, message);
    }
  }, [onTranscript, onTranscriptError]);

  const startRecording = React.useCallback(async () => {
    setIsTogglingRecording(true);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        console.warn("[sunday] microphone permission was denied");
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
      recordingStartedAtRef.current = Date.now();
      console.log("[sunday] recording started");
    } finally {
      setIsTogglingRecording(false);
    }
  }, [recorder]);

  const stopRecording = React.useCallback(async () => {
    setIsTogglingRecording(true);
    try {
      const liveStatus = recorder.getStatus();
      const wallClockDurationMillis = recordingStartedAtRef.current
        ? Math.max(0, Date.now() - recordingStartedAtRef.current)
        : 0;
      const liveDurationMillis = Math.max(
        recorderState.durationMillis ?? 0,
        liveStatus.durationMillis ?? 0,
        wallClockDurationMillis,
      );
      await recorder.stop();
      await setAudioModeAsync({
        allowsRecording: false,
      });
      const finalStatus = recorder.getStatus();
      const durationMillis = Math.max(
        liveDurationMillis,
        finalStatus.durationMillis ?? 0,
      );
      recordingStartedAtRef.current = null;
      if (durationMillis < MIN_RECORDING_DURATION_MILLIS) {
        console.log(
          `[sunday] recording ignored (${durationMillis}ms is below ${MIN_RECORDING_DURATION_MILLIS}ms)`,
        );
        return;
      }
      const recordingUrl = recorder.uri ?? recorder.getStatus().url ?? recorderState.url;
      if (!recordingUrl) {
        throw new Error("No recording file was produced.");
      }

      const persistedRecordingUrl = await persistRecordingFile(recordingUrl);
      console.log("[sunday] recording stopped");
      const entryId = onTranscriptPending?.(persistedRecordingUrl);
      if (entryId) {
        void transcribeRecording(entryId, persistedRecordingUrl);
      } else {
        void transcribeRecording(`${Date.now()}`, persistedRecordingUrl);
      }
    } catch (error) {
      console.error("[sunday] failed to stop recording", error);
    } finally {
      recordingStartedAtRef.current = null;
      setIsTogglingRecording(false);
    }
  }, [onTranscriptPending, recorder, recorderState.durationMillis, recorderState.url, transcribeRecording]);

  const handleDotPress = React.useCallback(async (event?: GestureResponderEvent) => {
    event?.stopPropagation?.();
    if (isTogglingRecording) {
      return;
    }

    pulseDot();
    if (isRecording) {
      await stopRecording();
      return;
    }

    await startRecording();
  }, [isRecording, isTogglingRecording, pulseDot, startRecording, stopRecording]);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <View style={styles.container}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleBackgroundPress} />
        <Pressable onPress={handleDotPress} style={styles.centerDotTapTarget}>
          <Animated.View
            style={[
              styles.centerDot,
              {
                backgroundColor: isRecording ? RECORDING : "#ffffff",
                transform: [{ scale }],
                opacity: isTogglingRecording ? 0.9 : 1,
              },
            ]}
          />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BACKGROUND,
  },
  container: {
    flex: 1,
    backgroundColor: BACKGROUND,
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  centerDotTapTarget: {
    width: DOT_SIZE,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  centerDot: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 999,
    backgroundColor: "#ffffff",
  },
});
