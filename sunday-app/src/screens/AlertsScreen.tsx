import React from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Swipeable from "react-native-gesture-handler/Swipeable";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { FONTS } from "../constants/fonts";

const BACKGROUND = "#121212";
const CARD = "#242424";
const EMPTY = "#8b8b8b";
const DELETE = "#eb4034";

export type AlertEntry = {
  id: string;
  summary: string;
  transcript: string;
  createdAt: string;
  status: "pending" | "complete" | "failed";
};

type AlertsScreenProps = {
  entries: AlertEntry[];
  onDeleteEntry?: (entryId: string) => void;
};

function TrashIcon({ size = 20, color = "#ffffff" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 -960 960 960" fill="none">
      <Path
        d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z"
        fill={color}
      />
    </Svg>
  );
}

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
        Recorded notes will show up here.
      </Text>
    </View>
  );
}

export function AlertsScreen({ entries, onDeleteEntry }: AlertsScreenProps) {
  const insets = useSafeAreaInsets();
  const headerTopInset = insets.top + 8;

  const renderRightActions = React.useCallback(
    (item: AlertEntry, progress: Animated.AnimatedInterpolation<number>) => {
      const opacity = progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0.4, 1],
        extrapolate: "clamp",
      });

      return (
        <Animated.View style={[styles.deleteActionWrap, { opacity }]}>
          <Pressable
            onPress={() => onDeleteEntry?.(item.id)}
            style={styles.deleteAction}
          >
            <TrashIcon />
          </Pressable>
        </Animated.View>
      );
    },
    [onDeleteEntry],
  );

  return (
    <SafeAreaView edges={["left", "right"]} style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        contentContainerStyle={entries.length ? styles.listContent : styles.emptyContent}
        scrollEnabled
        bounces
        alwaysBounceVertical
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={styles.rowSeparator} />}
        ListHeaderComponent={(
          <View style={[styles.header, { paddingTop: headerTopInset }]}>
            <Text style={styles.headerTitle}>Entries</Text>
          </View>
        )}
        ListEmptyComponent={renderEmptyState}
        renderItem={({ item }) => (
          <Swipeable
            friction={1.8}
            overshootRight={false}
            rightThreshold={36}
            renderRightActions={(progress) => renderRightActions(item, progress)}
          >
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
                  {item.status === "failed" && item.transcript ? (
                    <Text style={styles.failureBody}>{item.transcript}</Text>
                  ) : null}
                </View>
              </View>
              <Text style={styles.timestamp}>{formatTimestamp(item.createdAt)}</Text>
            </Pressable>
          </Swipeable>
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
    paddingBottom: 120,
  },
  emptyContent: {
    flexGrow: 1,
    paddingHorizontal: 18,
    paddingBottom: 120,
  },
  header: {
    paddingBottom: 18,
  },
  headerTitle: {
    color: "#ffffff",
    fontSize: 28,
    fontFamily: FONTS.semibold,
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
    borderRadius: 18,
    backgroundColor: CARD,
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
  failureBody: {
    marginTop: 6,
    color: EMPTY,
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FONTS.regular,
  },
  timestamp: {
    color: EMPTY,
    fontSize: 13,
    fontFamily: FONTS.medium,
    textAlign: "right",
  },
  rowSeparator: {
    height: 12,
  },
  deleteActionWrap: {
    width: 88,
    paddingLeft: 10,
  },
  deleteAction: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: DELETE,
    alignItems: "center",
    justifyContent: "center",
  },
});
