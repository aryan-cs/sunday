import React from "react";
import { StyleSheet, Text, View } from "react-native";

export function EmptyState() {
  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>📭</Text>
      <Text style={styles.text}>Nothing coming up</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", paddingVertical: 60 },
  emoji: { fontSize: 40, marginBottom: 12 },
  text: { fontSize: 16, color: "#999" },
});
