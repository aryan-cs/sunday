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
  status: "pending" | "complete";
};

type AlertsScreenProps = {
  entries: AlertEntry[];
  onDeleteEntry?: (entryId: string) => void;
};

function TrashIcon({ size = 20, color = "#ffffff" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 7H19"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Path
        d="M10 11V17"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Path
        d="M14 11V17"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Path
        d="M8 7L9 5H15L16 7"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M18 7L17.2 18.2C17.14 19.04 16.44 19.69 15.59 19.69H8.41C7.56 19.69 6.86 19.04 6.8 18.2L6 7"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
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
  const listHeaderHeight = insets.top + 8;

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
        ListHeaderComponent={entries.length ? <View style={{ height: listHeaderHeight }} /> : null}
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
