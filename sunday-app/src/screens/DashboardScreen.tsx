import React from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { EmptyState } from "../components/EmptyState";
import { ErrorBanner } from "../components/ErrorBanner";
import { EventCard } from "../components/EventCard";
import { useEvents } from "../hooks/useEvents";
import { useLocation } from "../hooks/useLocation";
import { CalendarEvent } from "../types";

export function DashboardScreen() {
  const { events, loading, error, lastUpdated, refresh } = useEvents();
  useLocation();

  const formatLastUpdated = () => {
    if (!lastUpdated) return "";
    return `Updated ${lastUpdated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Sunday</Text>
        {lastUpdated && <Text style={styles.updated}>{formatLastUpdated()}</Text>}
      </View>

      {loading && events.length === 0 ? (
        <ActivityIndicator style={styles.spinner} />
      ) : (
        <FlatList<CalendarEvent>
          data={events}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <EventCard event={item} />}
          contentContainerStyle={styles.list}
          ListHeaderComponent={error ? <ErrorBanner message={error} /> : null}
          ListEmptyComponent={<EmptyState />}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={refresh} />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f5f5f5" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { fontSize: 24, fontWeight: "700", color: "#1a1a1a" },
  updated: { fontSize: 12, color: "#999" },
  spinner: { marginTop: 60 },
  list: { padding: 16 },
});
