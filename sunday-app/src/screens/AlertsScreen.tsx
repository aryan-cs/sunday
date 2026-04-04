import React from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FONTS } from "../constants/fonts";

const BACKGROUND = "#121212";
const CARD = "#1b1b1b";
const BORDER = "#2a2a2a";
const EMPTY = "#8b8b8b";

export type AlertEntry = {
  id: string;
  summary: string;
  transcript: string;
  createdAt: string;
  status: "pending" | "complete";
};

type AlertsScreenProps = {
  entries: AlertEntry[];
};

function formatTimestamp(isoString: string) {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function renderEmptyState() {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>No transcriptions yet</Text>
      <Text style={styles.emptyBody}>
        Start and stop a recording to add an entry here.
      </Text>
    </View>
  );
}

export function AlertsScreen({ entries }: AlertsScreenProps) {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        contentContainerStyle={entries.length ? styles.listContent : styles.emptyContent}
        scrollEnabled
        bounces
        alwaysBounceVertical
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={renderEmptyState}
        renderItem={({ item }) => (
          <Pressable style={styles.card}>
            <View style={styles.cardMain}>
              {item.status === "pending" ? (
                <ActivityIndicator
                  size="small"
                  color="#ffffff"
                  style={styles.loadingSpinner}
                />
              ) : null}
              <View style={styles.cardText}>
                <Text style={styles.summary}>
                  {item.status === "pending" ? "Transcription loading..." : item.summary}
                </Text>
              </View>
            </View>
            <Text style={styles.timestamp}>{formatTimestamp(item.createdAt)}</Text>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BACKGROUND,
  },
  listContent: {
    flexGrow: 1,
    paddingHorizontal: 18,
    paddingTop: 24,
    paddingBottom: 120,
    gap: 12,
  },
  emptyContent: {
    flexGrow: 1,
    paddingHorizontal: 28,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    color: "#ffffff",
    fontSize: 22,
    fontFamily: FONTS.semibold,
    marginBottom: 8,
  },
  emptyBody: {
    color: EMPTY,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: FONTS.regular,
    textAlign: "center",
    maxWidth: 260,
  },
  card: {
    minHeight: 72,
    borderRadius: 24,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 18,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 16,
  },
  loadingSpinner: {
    marginRight: 12,
  },
  cardText: {
    flex: 1,
  },
  summary: {
    color: "#ffffff",
    fontSize: 17,
    lineHeight: 24,
    fontFamily: FONTS.medium,
  },
  timestamp: {
    color: EMPTY,
    fontSize: 13,
    fontFamily: FONTS.medium,
    textAlign: "right",
  },
});
