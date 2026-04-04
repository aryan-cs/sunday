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
import { uploadRecordingForTranscription } from "../lib/transcription";

const BACKGROUND = "#121212";
const DOT_SIZE = "50%";
const RECORDING = "#eb4034";

type HomeScreenProps = {
  onBackgroundPress?: () => void;
  onTranscript?: (transcript: string) => void;
};

export function HomeScreen({ onBackgroundPress, onTranscript }: HomeScreenProps) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 200);
  const [isTogglingRecording, setIsTogglingRecording] = React.useState(false);
  const scale = React.useRef(new Animated.Value(1)).current;
  const isRecording = recorderState.isRecording;

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

  const transcribeRecording = React.useCallback(async (recordingUrl: string) => {
    try {
      console.log("[sunday] uploading recording for transcription");
      const transcript = await uploadRecordingForTranscription(recordingUrl);
      console.log("[sunday] transcript:", transcript);
      onTranscript?.(transcript);
    } catch (error) {
      console.error("[sunday] transcription failed", error);
    }
  }, [onTranscript]);

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
      console.log("[sunday] recording started");
    } finally {
      setIsTogglingRecording(false);
    }
  }, [recorder]);

  const stopRecording = React.useCallback(async () => {
    setIsTogglingRecording(true);
    try {
      await recorder.stop();
      await setAudioModeAsync({
        allowsRecording: false,
      });
      const recordingUrl = recorder.uri ?? recorder.getStatus().url ?? recorderState.url;
      if (!recordingUrl) {
        throw new Error("No recording file was produced.");
      }

      console.log("[sunday] recording stopped");
      void transcribeRecording(recordingUrl);
    } catch (error) {
      console.error("[sunday] failed to stop recording", error);
    } finally {
      setIsTogglingRecording(false);
    }
  }, [recorder, recorderState.url, transcribeRecording]);

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
