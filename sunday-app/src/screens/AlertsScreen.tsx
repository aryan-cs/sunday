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
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import Swipeable from "react-native-gesture-handler/Swipeable";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { FONTS } from "../constants/fonts";
import { AlertEntry } from "../lib/alertEntries";

const BACKGROUND = "#121212";
const CARD = "#242424";
const EMPTY = "#8b8b8b";
const DELETE = "#eb4034";

type AlertsScreenProps = {
  entries: AlertEntry[];
  onDeleteEntry?: (entryId: string) => void;
};

type AlertRowProps = {
  item: AlertEntry;
  isActive: boolean;
  onPlaybackChange?: (entryId: string | null) => void;
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

function PlayCircleIcon({ size = 24, color = "#e3e3e3" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 -960 960 960" fill="none">
      <Path
        d="m380-300 280-180-280-180v360ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"
        fill={color}
      />
    </Svg>
  );
}

function PauseCircleIcon({ size = 24, color = "#e3e3e3" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 -960 960 960" fill="none">
      <Path
        d="M360-320h80v-320h-80v320Zm160 0h80v-320h-80v320ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"
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

function AlertRow({ item, isActive, onPlaybackChange, onDeleteEntry }: AlertRowProps) {
  const closeBounceX = React.useRef(new Animated.Value(0)).current;
  const player = useAudioPlayer(item.audioUri ? { uri: item.audioUri } : null, {
    updateInterval: 100,
  });
  const playbackStatus = useAudioPlayerStatus(player);
  const progress = playbackStatus.duration > 0
    ? Math.min(1, Math.max(0, playbackStatus.currentTime / playbackStatus.duration))
    : 0;

  const handleSwipeableWillClose = React.useCallback(() => {
    closeBounceX.stopAnimation();
    closeBounceX.setValue(0);
    Animated.sequence([
      Animated.timing(closeBounceX, {
        toValue: 10,
        duration: 70,
        useNativeDriver: true,
      }),
      Animated.spring(closeBounceX, {
        toValue: 0,
        speed: 22,
        bounciness: 7,
        useNativeDriver: true,
      }),
    ]).start();
  }, [closeBounceX]);

  React.useEffect(() => {
    if (!item.audioUri || isActive) {
      return;
    }

    if (playbackStatus.playing || playbackStatus.currentTime > 0) {
      player.pause();
      void player.seekTo(0).catch(() => undefined);
    }
  }, [
    isActive,
    item.audioUri,
    playbackStatus.currentTime,
    playbackStatus.playing,
    player,
  ]);

  React.useEffect(() => {
    if (!item.audioUri || !playbackStatus.didJustFinish) {
      return;
    }

    onPlaybackChange?.(null);
    void player.seekTo(0).catch(() => undefined);
  }, [item.audioUri, onPlaybackChange, playbackStatus.didJustFinish, player]);

  const handlePlayPausePress = React.useCallback(async () => {
    if (!item.audioUri) {
      return;
    }

    if (isActive && playbackStatus.playing) {
      player.pause();
      onPlaybackChange?.(null);
      return;
    }

    if (
      playbackStatus.duration > 0 &&
      playbackStatus.currentTime >= Math.max(playbackStatus.duration - 0.05, 0)
    ) {
      await player.seekTo(0).catch(() => undefined);
    }

    onPlaybackChange?.(item.id);
    player.play();
  }, [
    isActive,
    item.audioUri,
    item.id,
    onPlaybackChange,
    playbackStatus.currentTime,
    playbackStatus.duration,
    playbackStatus.playing,
    player,
  ]);

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
          onSwipeableWillClose={handleSwipeableWillClose}
          renderRightActions={renderRightActions}
        >
          <View style={styles.card}>
            <View style={styles.cardMain}>
              {item.status === "pending" ? (
                <View style={styles.leadingAccessory}>
                  <ActivityIndicator
                    size="small"
                    color="#ffffff"
                  />
                </View>
              ) : item.audioUri ? (
                <Pressable
                  hitSlop={8}
                  onPress={handlePlayPausePress}
                  style={styles.leadingAccessory}
                >
                  {isActive && playbackStatus.playing ? (
                    <PauseCircleIcon />
                  ) : (
                    <PlayCircleIcon />
                  )}
                </Pressable>
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
            {item.audioUri ? (
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.max(progress * 100, 0)}%`,
                    },
                  ]}
                />
              </View>
            ) : null}
          </View>
        </Swipeable>
      </Animated.View>
    </View>
  );
}

export function AlertsScreen({ entries, onDeleteEntry }: AlertsScreenProps) {
  const insets = useSafeAreaInsets();
  const headerTopInset = insets.top + 8;
  const [playingEntryId, setPlayingEntryId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!playingEntryId) {
      return;
    }

    if (!entries.some((entry) => entry.id === playingEntryId)) {
      setPlayingEntryId(null);
    }
  }, [entries, playingEntryId]);

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
          <AlertRow
            item={item}
            isActive={playingEntryId === item.id}
            onPlaybackChange={setPlayingEntryId}
            onDeleteEntry={onDeleteEntry}
          />
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
    paddingBottom: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    overflow: "hidden",
  },
  cardMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 16,
  },
  leadingAccessory: {
    width: 28,
    height: 28,
    marginRight: 12,
    alignItems: "center",
    justifyContent: "center",
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
  progressTrack: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 8,
    height: 3,
    borderRadius: 999,
    backgroundColor: "#2f2f2f",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#f4f4f4",
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
