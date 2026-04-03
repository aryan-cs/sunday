import React from "react";
import { StyleSheet, Text, View } from "react-native";

interface Props {
  message: string;
}

export function ErrorBanner({ message }: Props) {
  return (
    <View style={styles.banner}>
      <Text style={styles.text}>⚠️ {message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: "#fff3cd",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  text: { fontSize: 13, color: "#856404" },
});
