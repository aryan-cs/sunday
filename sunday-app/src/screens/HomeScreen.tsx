import React from "react";
import {
  Animated,
  Pressable,
  StatusBar,
  StyleSheet,
  GestureResponderEvent,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const BACKGROUND = "#121212";
const DOT_SIZE = "50%";
const RECORDING = "#eb4034";

type HomeScreenProps = {
  onBackgroundPress?: () => void;
};

export function HomeScreen({ onBackgroundPress }: HomeScreenProps) {
  const [isRecording, setIsRecording] = React.useState(false);
  const scale = React.useRef(new Animated.Value(1)).current;

  const handleBackgroundPress = React.useCallback(() => {
    onBackgroundPress?.();
  }, [onBackgroundPress]);

  const handleDotPress = React.useCallback((event?: GestureResponderEvent) => {
    event?.stopPropagation?.();
    scale.stopAnimation(() => {
      scale.setValue(1);
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.15,
          duration: 80,
          useNativeDriver: true,
        }),
        Animated.spring(scale, {
          toValue: 1,
          speed: 50,
          bounciness: 10,
          useNativeDriver: true,
        }),
      ]).start();
    });
    setIsRecording((current) => !current);
  }, [scale]);

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
