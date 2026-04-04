import React from "react";
import { Pressable, StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const BACKGROUND = "#121212";
const DOT_SIZE = "25%";

export function HomeScreen() {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <View style={styles.container}>
        <Pressable onPress={() => {}} style={styles.topRightButton}>
          <Text style={styles.settingsIcon}>⚙︎</Text>
        </Pressable>
        <View style={styles.centerDot} />
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
    top: 10,
    right: 16,
    zIndex: 2,
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  settingsIcon: {
    color: "#f5f5f5",
    fontSize: 20,
    lineHeight: 20,
  },
  centerDot: {
    width: DOT_SIZE,
    aspectRatio: 1,
    borderRadius: 999,
    backgroundColor: "#ffffff",
  },
});
