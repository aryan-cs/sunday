import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { CalendarEvent } from "../types";
import { CountdownTimer } from "./CountdownTimer";

interface Props {
  event: CalendarEvent;
}

const TRAVEL_MODE_ICON: Record<string, string> = {
  driving: "🚗",
  walking: "🚶",
  bicycling: "🚲",
  transit: "🚌",
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatTimeRange(startIso: string, endIso: string): string {
  return `${formatTime(startIso)} – ${formatTime(endIso)}`;
}

export function EventCard({ event }: Props) {
  const modeIcon = TRAVEL_MODE_ICON[event.travel_mode ?? ""] ?? "🗺️";
  const isLeaveUrgent =
    event.leave_by_iso != null &&
    new Date(event.leave_by_iso).getTime() - Date.now() < 30 * 60 * 1000;

  return (
    <View style={[styles.card, isLeaveUrgent && styles.urgentCard]}>
      <Text style={styles.title}>{event.title}</Text>
      <Text style={styles.time}>{formatTimeRange(event.start_iso, event.end_iso)}</Text>

      {event.location != null && (
        <Text style={styles.detail}>📍 {event.location}</Text>
      )}

      {event.is_online && event.meeting_link != null && (
        <Text style={styles.detail}>🔗 Online meeting</Text>
      )}

      {event.travel_minutes != null && (
        <Text style={styles.detail}>
          {modeIcon} {event.travel_minutes} min {event.travel_mode ?? ""}
        </Text>
      )}

      {event.leave_by_iso != null && (
        <View style={styles.leaveRow}>
          <Text style={styles.leaveBy}>
            leave by {formatTime(event.leave_by_iso)}
          </Text>
          <CountdownTimer targetIso={event.leave_by_iso} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  urgentCard: {
    borderLeftWidth: 3,
    borderLeftColor: "#e74c3c",
  },
  title: { fontSize: 16, fontWeight: "600", color: "#1a1a1a", marginBottom: 4 },
  time: { fontSize: 14, color: "#555", marginBottom: 8 },
  detail: { fontSize: 13, color: "#555", marginBottom: 4 },
  leaveRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#eee",
  },
  leaveBy: { fontSize: 13, fontWeight: "600", color: "#333" },
});
