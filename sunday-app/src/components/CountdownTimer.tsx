import React, { useEffect, useState } from "react";
import { StyleSheet, Text } from "react-native";

interface Props {
  targetIso: string;
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "now";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function CountdownTimer({ targetIso }: Props) {
  const target = new Date(targetIso).getTime();
  const [remaining, setRemaining] = useState(target - Date.now());

  useEffect(() => {
    const interval = setInterval(() => setRemaining(target - Date.now()), 1000);
    return () => clearInterval(interval);
  }, [target]);

  const isUrgent = remaining > 0 && remaining < 30 * 60 * 1000;

  return (
    <Text style={[styles.text, isUrgent && styles.urgent]}>
      {remaining <= 0 ? "leave now" : `leave in ${formatCountdown(remaining)}`}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: 13, color: "#666", fontWeight: "500" },
  urgent: { color: "#e74c3c", fontWeight: "700" },
});
