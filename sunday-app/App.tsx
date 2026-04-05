import React from "react";
import { useFonts } from "expo-font";
import {
  Animated,
  Dimensions,
  Keyboard,
  LayoutAnimation,
  Pressable,
  Platform,
  ScrollView,
  StyleSheet,
  UIManager,
  View,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { HomeScreen } from "./src/screens/HomeScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { AlertsScreen } from "./src/screens/AlertsScreen";
import { TodayScreen } from "./src/screens/TodayScreen";
import {
  SettingsIcon,
  TodayIcon,
  RecordActiveIcon,
  RecordInactiveIcon,
  AlertIcon,
} from "./src/components/NavIcons";
import { ActionItem, AlertEntry } from "./src/lib/alertEntries";
import {
  deleteStoredAlertAudio,
  loadStoredAlertEntries,
  saveStoredAlertEntries,
} from "./src/lib/entryStore";
import { fetchActionCenterEntries } from "./src/lib/actionCenterSync";
import { summarizeTranscript } from "./src/lib/transcriptSummary";
import { syncDeviceContacts } from "./src/lib/contactsSync";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const BACKGROUND = "#121212";
const NAV_HEIGHT = 60;
const NAV_SIDE_INSET = 24;
const NAV_HORIZONTAL_PADDING = 10;
const INDICATOR_MARGIN = 6;
const INDICATOR_HORIZONTAL_INSET = 4;
const ACTIVE_COLOR = "#ffffff";
const SELECTED_ICON_COLOR = BACKGROUND;
const INACTIVE_COLOR = "#f4f4f4";
const RECORD_ACTIVE_COLOR = "#eb4034";

// Order: Settings (0) — Today (1) — Record (2) — Alerts (3)
// Record starts as the active/center screen.
const TABS = [
  { key: "settings", Icon: SettingsIcon },
  { key: "today", Icon: TodayIcon },
  { key: "record", Icon: RecordInactiveIcon },
  { key: "alerts", Icon: AlertIcon },
] as const;

const INITIAL_INDEX = 2;
const NAV_WIDTH = SCREEN_WIDTH - NAV_SIDE_INSET * 2;
const NAV_CONTENT_WIDTH = NAV_WIDTH - NAV_HORIZONTAL_PADDING * 2;
const NAV_ITEM_WIDTH = (NAV_WIDTH - NAV_HORIZONTAL_PADDING * 2) / TABS.length;
const INDICATOR_WIDTH = NAV_ITEM_WIDTH - INDICATOR_HORIZONTAL_INSET * 2;
const INDICATOR_EDGE_EXTENSION = 8;
const RECORD_TAB_INDEX = 1;
const ALERTS_TAB_INDEX = 2;

function getIndicatorTarget(index: number) {
  if (index === 0 || index === TABS.length - 1) {
    return index * NAV_ITEM_WIDTH - INDICATOR_EDGE_EXTENSION;
  }
  return index * NAV_ITEM_WIDTH;
}

function getIndicatorWidth(index: number) {
  if (index === 0 || index === TABS.length - 1) {
    return INDICATOR_WIDTH + INDICATOR_EDGE_EXTENSION * 2;
  }
  return INDICATOR_WIDTH;
}

type RecordTabIconProps = {
  size?: number;
  inactiveColor: string;
  activeColor: string;
  progress: Animated.Value;
};

function RecordTabIcon({
  size = 24,
  inactiveColor,
  activeColor,
  progress,
}: RecordTabIconProps) {
  const inactiveOpacity = React.useMemo(
    () =>
      progress.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 0],
      }),
    [progress],
  );

  return (
    <View style={[styles.recordIconContainer, { width: size, height: size }]}>
      <Animated.View style={[styles.recordIconLayer, { opacity: inactiveOpacity }]}>
        <RecordInactiveIcon size={size} color={inactiveColor} />
      </Animated.View>
      <Animated.View style={[styles.recordIconLayer, { opacity: progress }]}>
        <RecordActiveIcon size={size} color={activeColor} />
      </Animated.View>
    </View>
  );
}

function Main() {
  const insets = useSafeAreaInsets();
  const scrollRef = React.useRef<ScrollView>(null);
  const scrollX = React.useRef(new Animated.Value(INITIAL_INDEX * SCREEN_WIDTH)).current;
  const navTranslateY = React.useRef(new Animated.Value(0)).current;
  const recordIconProgress = React.useRef(new Animated.Value(0)).current;
  const [activeIndex, setActiveIndex] = React.useState(INITIAL_INDEX);
  const [navVisible, setNavVisible] = React.useState(true);
  const [isRecordingActive, setIsRecordingActive] = React.useState(false);
  const [isPagerScrollLocked, setIsPagerScrollLocked] = React.useState(false);
  const [alertEntries, setAlertEntries] = React.useState<AlertEntry[]>([]);
  const [entriesHydrated, setEntriesHydrated] = React.useState(false);
  const indicatorTranslateX = React.useMemo(
    () =>
      scrollX.interpolate({
        inputRange: TABS.map((_, index) => index * SCREEN_WIDTH),
        outputRange: TABS.map((_, index) => getIndicatorTarget(index)),
        extrapolate: "clamp",
      }),
    [scrollX],
  );
  const indicatorWidth = React.useMemo(
    () =>
      scrollX.interpolate({
        inputRange: TABS.map((_, index) => index * SCREEN_WIDTH),
        outputRange: TABS.map((_, index) => getIndicatorWidth(index)),
        extrapolate: "clamp",
      }),
    [scrollX],
  );
  const indicatorIconTranslateX = React.useMemo(
    () => Animated.multiply(indicatorTranslateX, -1),
    [indicatorTranslateX],
  );
  const navHiddenOffset = NAV_HEIGHT + Math.max(insets.bottom, 14) + 18;

  React.useEffect(() => {
    if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  const animateNavVisibility = React.useCallback(
    (visible: boolean) => {
      const target = visible ? 0 : navHiddenOffset;
      navTranslateY.stopAnimation((currentValue: number) => {
        if (Math.abs(target - currentValue) < 0.5) {
          return;
        }

        const direction = visible ? -1 : 1;
        const overshoot = target + direction * 8;

        Animated.sequence([
          Animated.timing(navTranslateY, {
            toValue: overshoot,
            duration: 140,
            useNativeDriver: false,
          }),
          Animated.spring(navTranslateY, {
            toValue: target,
            speed: 19,
            bounciness: 9,
            useNativeDriver: false,
          }),
        ]).start();
      });
      setNavVisible(visible);
    },
    [navHiddenOffset, navTranslateY],
  );

  const handleTabPress = React.useCallback(
    (index: number) => {
      Keyboard.dismiss();
      if (index !== RECORD_TAB_INDEX && !navVisible) {
        animateNavVisibility(true);
      }
      setActiveIndex(index);
      scrollRef.current?.scrollTo({ x: index * SCREEN_WIDTH, animated: true });
    },
    [animateNavVisibility, navVisible],
  );

  const handleMomentumEnd = React.useCallback(
    (e: any) => {
      const page = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
      if (page === activeIndex) {
        return;
      }
      setActiveIndex(page);
      if (page !== RECORD_TAB_INDEX && !navVisible) {
        animateNavVisibility(true);
      }
    },
    [activeIndex, animateNavVisibility, navVisible],
  );

  const handleRecordBackgroundPress = React.useCallback(() => {
    if (activeIndex !== RECORD_TAB_INDEX) {
      return;
    }
    animateNavVisibility(!navVisible);
  }, [activeIndex, animateNavVisibility, navVisible]);

  const handleTranscriptPending = React.useCallback((audioUri: string) => {
    const createdAt = new Date().toISOString();
    const id = `${createdAt}-${Math.random().toString(36).slice(2, 8)}`;
    const entry: AlertEntry = {
      id,
      transcript: "",
      summary: "Transcription loading...",
      createdAt,
      status: "pending",
      audioUri,
    };
    setAlertEntries((current) => [entry, ...current]);
    return id;
  }, []);

  const handleTranscript = React.useCallback((entryId: string, transcript: string, summary?: string, actions?: ActionItem[]) => {
    setAlertEntries((current) =>
      current.map((entry) =>
        entry.id === entryId
          ? {
              ...entry,
              transcript,
              summary: (summary?.trim() || summarizeTranscript(transcript)).trim(),
              status: "complete",
              actions,
            }
          : entry,
      ),
    );
  }, []);

  const handleTranscriptError = React.useCallback((entryId: string, message: string) => {
    setAlertEntries((current) =>
      current.map((entry) =>
        entry.id === entryId
          ? {
              ...entry,
              transcript: message,
              summary: "Transcription failed",
              status: "failed",
            }
          : entry,
      ),
    );
  }, []);

  const handleDeleteAlert = React.useCallback((entryId: string) => {
    LayoutAnimation.configureNext({
      duration: 260,
      create: {
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.opacity,
      },
      update: {
        type: LayoutAnimation.Types.spring,
        springDamping: 0.82,
      },
      delete: {
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.opacity,
      },
    });

    setAlertEntries((current) => {
      const entryToDelete = current.find((entry) => entry.id === entryId);
      if (entryToDelete?.audioUri) {
        void deleteStoredAlertAudio(entryToDelete.audioUri);
      }
      return current.filter((entry) => entry.id !== entryId);
    });
  }, []);

  const mergeActionCenterEntries = React.useCallback((incoming: AlertEntry[]) => {
    if (incoming.length === 0) {
      return;
    }
    setAlertEntries((current) => {
      const byId = new Map<string, AlertEntry>();
      for (const entry of current) {
        byId.set(entry.id, entry);
      }
      for (const entry of incoming) {
        byId.set(entry.id, entry);
      }
      return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
  }, []);

  const syncActionCenter = React.useCallback(async () => {
    try {
      const remoteEntries = await fetchActionCenterEntries(120);
      mergeActionCenterEntries(remoteEntries);
    } catch (error) {
      console.warn(
        "[sunday] action center sync failed",
        error instanceof Error ? error.message : error,
      );
    }
  }, [mergeActionCenterEntries]);

  React.useEffect(() => {
    let isCancelled = false;

    const hydrateEntries = async () => {
      const storedEntries = await loadStoredAlertEntries();
      if (isCancelled) {
        return;
      }

      setAlertEntries(storedEntries);
      setEntriesHydrated(true);
    };

    void hydrateEntries();

    return () => {
      isCancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!entriesHydrated) {
      return;
    }

    let intervalId: ReturnType<typeof setInterval> | null = null;
    void syncActionCenter();
    intervalId = setInterval(() => {
      void syncActionCenter();
    }, 60000);

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [entriesHydrated, syncActionCenter]);

  React.useEffect(() => {
    if (!entriesHydrated) {
      return;
    }
    if (activeIndex === ALERTS_TAB_INDEX) {
      void syncActionCenter();
    }
  }, [activeIndex, entriesHydrated, syncActionCenter]);

  React.useEffect(() => {
    void (async () => {
      try {
        const result = await syncDeviceContacts();
        if (result.ok && !result.skipped) {
          console.log(`[sunday] synced ${result.count} contact(s)`);
        }
      } catch (error) {
        console.warn(
          "[sunday] contact sync failed",
          error instanceof Error ? error.message : error,
        );
      }
    })();
  }, []);

  React.useEffect(() => {
    if (!entriesHydrated) {
      return;
    }

    void saveStoredAlertEntries(alertEntries);
  }, [alertEntries, entriesHydrated]);

  React.useEffect(() => {
    if (activeIndex !== RECORD_TAB_INDEX && !navVisible) {
      animateNavVisibility(true);
    }
  }, [activeIndex, animateNavVisibility, navVisible]);

  React.useEffect(() => {
    Animated.timing(recordIconProgress, {
      toValue: isRecordingActive ? 1 : 0,
      duration: 100,
      useNativeDriver: false,
    }).start();
  }, [isRecordingActive, recordIconProgress]);

  const navBarBottom = Math.max(insets.bottom, 14);

  const navBarAnimatedStyle = React.useMemo(
    () => ({
      bottom: navBarBottom,
      transform: [{ translateY: navTranslateY }],
    }),
    [navBarBottom, navTranslateY],
  );

  return (
    <View style={styles.root}>
      {/* Screens */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        bounces={false}
        scrollEnabled={!isPagerScrollLocked}
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: false },
        )}
        onScrollBeginDrag={() => Keyboard.dismiss()}
        onMomentumScrollEnd={handleMomentumEnd}
        contentOffset={{ x: INITIAL_INDEX * SCREEN_WIDTH, y: 0 }}
      >
        <View style={styles.page}>
          <SettingsScreen onSegmentInteractionChange={setIsPagerScrollLocked} />
        </View>
        <View style={styles.page}>
          <TodayScreen />
        </View>
        <View style={styles.page}>
          <HomeScreen
            onBackgroundPress={handleRecordBackgroundPress}
            onTranscriptPending={handleTranscriptPending}
            onTranscript={handleTranscript}
            onTranscriptError={handleTranscriptError}
            onRecordingChange={setIsRecordingActive}
          />
        </View>
        <View style={styles.page}>
          <AlertsScreen entries={alertEntries} onDeleteEntry={handleDeleteAlert} />
        </View>
      </ScrollView>

      {/* Bottom Nav */}
      <Animated.View
        style={[
          styles.navBar,
          navBarAnimatedStyle,
        ]}
      >
        {/* Layer 1: Inactive icons (visual only) */}
        {TABS.map((tab, i) => (
          <View key={tab.key} style={styles.navItem}>
            {i === RECORD_TAB_INDEX ? (
              <RecordTabIcon
                size={28}
                inactiveColor={INACTIVE_COLOR}
                activeColor={RECORD_ACTIVE_COLOR}
                progress={recordIconProgress}
              />
            ) : (
              <tab.Icon size={28} color={INACTIVE_COLOR} />
            )}
          </View>
        ))}

        {/* Layer 2: Sliding indicator with active icons (visual only) */}
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Animated.View
            style={[
              styles.activeIndicatorShadow,
              {
                width: indicatorWidth,
                transform: [{ translateX: indicatorTranslateX }],
              },
            ]}
          >
            <View style={styles.activeIndicator}>
              <Animated.View
                style={[
                  styles.indicatorIconTrack,
                  {
                    transform: [{ translateX: indicatorIconTranslateX }],
                  },
                ]}
              >
                {TABS.map((tab, i) => (
                  <View key={`${tab.key}-selected`} style={styles.indicatorIconSlot}>
                    {i === RECORD_TAB_INDEX ? (
                      <RecordTabIcon
                        size={28}
                        inactiveColor={SELECTED_ICON_COLOR}
                        activeColor={RECORD_ACTIVE_COLOR}
                        progress={recordIconProgress}
                      />
                    ) : (
                      <tab.Icon size={28} color={SELECTED_ICON_COLOR} />
                    )}
                  </View>
                ))}
              </Animated.View>
            </View>
          </Animated.View>
        </View>

        {/* Layer 3: Touch targets (on top, transparent) */}
        <View style={styles.navTouchLayer}>
          {TABS.map((tab, i) => (
            <Pressable
              key={`${tab.key}-touch`}
              onPress={() => handleTabPress(i)}
              style={styles.navTouchItem}
            />
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    "GoogleSans-Regular": require("./assets/fonts/GoogleSans-Regular.ttf"),
    "GoogleSans-Medium": require("./assets/fonts/GoogleSans-Medium.ttf"),
    "GoogleSans-SemiBold": require("./assets/fonts/GoogleSans-SemiBold.ttf"),
    "GoogleSans-Bold": require("./assets/fonts/GoogleSans-Bold.ttf"),
  });

  if (!fontsLoaded) {
    return null;
  }

  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
      <SafeAreaProvider>
        <Main />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  gestureRoot: {
    flex: 1,
  },
  root: {
    flex: 1,
    backgroundColor: BACKGROUND,
  },
  page: {
    width: SCREEN_WIDTH,
    flex: 1,
  },
  navBar: {
    position: "absolute",
    left: NAV_SIDE_INSET,
    right: NAV_SIDE_INSET,
    flexDirection: "row",
    backgroundColor: "#1b1b1b",
    borderRadius: 999,
    height: NAV_HEIGHT,
    paddingHorizontal: NAV_HORIZONTAL_PADDING,
    alignItems: "center",
    shadowColor: "#000000",
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
  },
  activeIndicatorShadow: {
    position: "absolute",
    left: NAV_HORIZONTAL_PADDING + INDICATOR_HORIZONTAL_INSET,
    top: INDICATOR_MARGIN,
    width: INDICATOR_WIDTH,
    height: NAV_HEIGHT - INDICATOR_MARGIN * 2,
    borderRadius: 999,
    justifyContent: "center",
    zIndex: 2,
    shadowColor: "#ffffff",
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  activeIndicator: {
    flex: 1,
    borderRadius: 999,
    backgroundColor: ACTIVE_COLOR,
    overflow: "hidden",
    justifyContent: "center",
  },
  indicatorIconTrack: {
    left: -INDICATOR_HORIZONTAL_INSET,
    width: NAV_CONTENT_WIDTH,
    height: "100%",
    flexDirection: "row",
  },
  indicatorIconSlot: {
    width: NAV_ITEM_WIDTH,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  recordIconContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  recordIconLayer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  navItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
  },
  navTouchLayer: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
    zIndex: 10,
  },
  navTouchItem: {
    flex: 1,
    height: "100%",
  },
});
