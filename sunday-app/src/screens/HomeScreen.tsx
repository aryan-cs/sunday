import React from "react";
import {
  GestureResponderEvent,
  Pressable,
  StatusBar,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const BACKGROUND = "#121212";
const DOT_SIZE = "50%";

type HomeScreenProps = {
  isRecording?: boolean;
  onBackgroundPress?: () => void;
  onToggleRecording?: () => void;
};

export function HomeScreen({
  isRecording = false,
  onBackgroundPress,
  onToggleRecording,
}: HomeScreenProps) {
  const handleBackgroundPress = React.useCallback(() => {
    onBackgroundPress?.();
  }, [onBackgroundPress]);

  const handleDotPress = React.useCallback((event?: GestureResponderEvent) => {
    event?.stopPropagation?.();
    onToggleRecording?.();
  }, [onToggleRecording]);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <View style={styles.container}>
        <Pressable style={StyleSheet.absoluteFill} onPress={handleBackgroundPress} />
        {!isRecording ? (
          <Pressable onPress={handleDotPress} style={styles.centerDotTapTarget}>
            <View style={styles.centerDot} />
          </Pressable>
        ) : null}
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
