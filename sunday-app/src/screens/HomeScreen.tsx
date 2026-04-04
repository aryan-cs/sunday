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
const DOT_SIZE = "25%";

export function HomeScreen() {
  const dotScale = React.useRef(new Animated.Value(1)).current;

  const handleDotPress = React.useCallback(() => {
    dotScale.stopAnimation(() => {
      dotScale.setValue(1);

      Animated.sequence([
        Animated.timing(dotScale, {
          toValue: 0.94,
          duration: 70,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.spring(dotScale, {
          toValue: 1.08,
          tension: 280,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.spring(dotScale, {
          toValue: 1,
          tension: 220,
          friction: 10,
          useNativeDriver: true,
        }),
      ]).start();
    });
  }, [dotScale]);

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
