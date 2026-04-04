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

type AlertRowProps = {
  item: AlertEntry;
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

function AlertRow({ item, onDeleteEntry }: AlertRowProps) {
  const closeBounceX = React.useRef(new Animated.Value(0)).current;

  const handleSwipeableClose = React.useCallback(() => {
    closeBounceX.stopAnimation();
    closeBounceX.setValue(0);
    Animated.sequence([
      Animated.timing(closeBounceX, {
        toValue: 8,
        duration: 90,
        useNativeDriver: true,
      }),
      Animated.spring(closeBounceX, {
        toValue: 0,
        speed: 18,
        bounciness: 8,
        useNativeDriver: true,
      }),
    ]).start();
  }, [closeBounceX]);

  const renderRightActions = React.useCallback(
    (
      progress: Animated.AnimatedInterpolation<number>,
      dragX: Animated.AnimatedInterpolation<number>,
    ) => {
      const opacity = progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0.4, 1],
        extrapolate: "clamp",
      });
      const scale = progress.interpolate({
        inputRange: [0, 0.8, 1, 1.18],
        outputRange: [0.86, 0.95, 1.06, 1],
        extrapolate: "clamp",
      });
      const translateX = dragX.interpolate({
        inputRange: [-156, -96, 0],
        outputRange: [-8, 0, 22],
        extrapolate: "clamp",
      });

      return (
        <Animated.View style={[styles.deleteActionWrap, { opacity, transform: [{ translateX }, { scale }] }]}>
          <Pressable
            onPress={() => onDeleteEntry?.(item.id)}
            style={styles.deleteAction}
          >
            <TrashIcon />
          </Pressable>
        </Animated.View>
      );
    },
    [item.id, onDeleteEntry],
  );

  return (
    <View style={styles.rowWrap}>
      <Animated.View style={{ transform: [{ translateX: closeBounceX }] }}>
        <Swipeable
          friction={1.25}
          overshootRight
          overshootFriction={6}
          rightThreshold={30}
          containerStyle={styles.swipeableContainer}
          childrenContainerStyle={styles.swipeableChildren}
          onSwipeableClose={handleSwipeableClose}
          renderRightActions={renderRightActions}
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
      </Animated.View>
    </View>
  );
}

export function AlertsScreen({ entries, onDeleteEntry }: AlertsScreenProps) {
  const insets = useSafeAreaInsets();
  const headerTopInset = insets.top + 8;

  return (
    <SafeAreaView edges={[]} style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        contentContainerStyle={entries.length ? styles.listContent : styles.emptyContent}
        removeClippedSubviews={false}
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
          <AlertRow item={item} onDeleteEntry={onDeleteEntry} />
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
    paddingBottom: 120,
  },
  emptyContent: {
    flexGrow: 1,
    paddingBottom: 120,
  },
  header: {
    paddingHorizontal: 18,
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
    paddingHorizontal: 18,
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
  rowWrap: {
    paddingHorizontal: 18,
    overflow: "visible",
  },
  swipeableContainer: {
    overflow: "visible",
  },
  swipeableChildren: {
    overflow: "visible",
  },
  deleteActionWrap: {
    width: 88,
    paddingLeft: 10,
    justifyContent: "center",
  },
  deleteAction: {
    flex: 1,
    borderRadius: 18,
    backgroundColor: DELETE,
    alignItems: "center",
    justifyContent: "center",
  },
});
