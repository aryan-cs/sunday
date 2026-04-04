import React from "react";
import {
  Animated,
  Easing,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const BACKGROUND = "#121212";
const DOT_SIZE = "50%";
const RECORDING = "#eb4034";

export function HomeScreen() {
  const [isRecording, setIsRecording] = React.useState(false);
  const dotScale = React.useRef(new Animated.Value(1)).current;
  const recordingProgress = React.useRef(new Animated.Value(0)).current;

  const handleDotPress = React.useCallback(() => {
    const nextRecording = !isRecording;

    setIsRecording(nextRecording);

    dotScale.stopAnimation(() => {
      dotScale.setValue(1);

      Animated.parallel([
        Animated.timing(recordingProgress, {
          toValue: nextRecording ? 1 : 0,
          duration: 180,
          easing: Easing.out(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.sequence([
          Animated.timing(dotScale, {
            toValue: 0.94,
            duration: 70,
            easing: Easing.out(Easing.quad),
            useNativeDriver: false,
          }),
          Animated.spring(dotScale, {
            toValue: 1.08,
            tension: 280,
            friction: 7,
            useNativeDriver: false,
          }),
          Animated.spring(dotScale, {
            toValue: 1,
            tension: 220,
            friction: 10,
            useNativeDriver: false,
          }),
        ]),
      ]).start();
    });
  }, [dotScale, isRecording, recordingProgress]);

  const dotBackground = recordingProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ["#ffffff", RECORDING],
  });

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <View style={styles.container}>
        <Pressable onPress={() => {}} style={styles.topRightButton}>
          <Text style={styles.settingsIcon}>⚙︎</Text>
        </Pressable>
        <Pressable onPress={handleDotPress} style={styles.centerDotTapTarget}>
          <Animated.View
            style={[
              styles.centerDot,
              {
                backgroundColor: dotBackground,
                transform: [{ scale: dotScale }],
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
  topRightButton: {
    position: "absolute",
    top: 12,
    right: 18,
    zIndex: 2,
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  settingsIcon: {
    color: "#f5f5f5",
    fontSize: 26,
    lineHeight: 26,
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
