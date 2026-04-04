import React from "react";
import { useFonts } from "expo-font";
import {
  Animated,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { HomeScreen } from "./src/screens/HomeScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { AlertEntry, AlertsScreen } from "./src/screens/AlertsScreen";
import {
  SettingsIcon,
  RecordActiveIcon,
  RecordInactiveIcon,
  AlertIcon,
} from "./src/components/NavIcons";
import { summarizeTranscript } from "./src/lib/transcriptSummary";

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

// Order: Settings (0) — Record (1) — Alerts (2)
// Record starts as the active/center screen.
const TABS = [
  { key: "settings", Icon: SettingsIcon },
  { key: "record", Icon: RecordInactiveIcon },
  { key: "alerts", Icon: AlertIcon },
] as const;

const INITIAL_INDEX = 1;
const NAV_WIDTH = SCREEN_WIDTH - NAV_SIDE_INSET * 2;
const NAV_CONTENT_WIDTH = NAV_WIDTH - NAV_HORIZONTAL_PADDING * 2;
const NAV_ITEM_WIDTH = (NAV_WIDTH - NAV_HORIZONTAL_PADDING * 2) / TABS.length;
const INDICATOR_WIDTH = NAV_ITEM_WIDTH - INDICATOR_HORIZONTAL_INSET * 2;
const INDICATOR_EDGE_EXTENSION = 8;
const RECORD_TAB_INDEX = 1;

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

function getTabIcon(index: number, isRecordingActive: boolean) {
  if (index !== RECORD_TAB_INDEX) {
    return TABS[index].Icon;
  }
  return isRecordingActive ? RecordActiveIcon : RecordInactiveIcon;
}

function Main() {
  const insets = useSafeAreaInsets();
  const scrollRef = React.useRef<ScrollView>(null);
  const scrollX = React.useRef(new Animated.Value(INITIAL_INDEX * SCREEN_WIDTH)).current;
  const navTranslateY = React.useRef(new Animated.Value(0)).current;
  const [activeIndex, setActiveIndex] = React.useState(INITIAL_INDEX);
  const [navVisible, setNavVisible] = React.useState(true);
  const [isRecordingActive, setIsRecordingActive] = React.useState(false);
  const [alertEntries, setAlertEntries] = React.useState<AlertEntry[]>([]);
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

  const handleTranscriptPending = React.useCallback(() => {
    const createdAt = new Date().toISOString();
    const id = `${createdAt}-${Math.random().toString(36).slice(2, 8)}`;
    const entry: AlertEntry = {
      id,
      transcript: "",
      summary: "Transcription loading...",
      createdAt,
      status: "pending",
    };
    setAlertEntries((current) => [entry, ...current]);
    return id;
  }, []);

  const handleTranscript = React.useCallback((entryId: string, transcript: string) => {
    setAlertEntries((current) =>
      current.map((entry) =>
        entry.id === entryId
          ? {
              ...entry,
              transcript,
              summary: summarizeTranscript(transcript),
              status: "complete",
            }
          : entry,
      ),
    );
  }, []);

  React.useEffect(() => {
    if (activeIndex !== RECORD_TAB_INDEX && !navVisible) {
      animateNavVisibility(true);
    }
  }, [activeIndex, animateNavVisibility, navVisible]);

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
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: false },
        )}
        onMomentumScrollEnd={handleMomentumEnd}
        contentOffset={{ x: INITIAL_INDEX * SCREEN_WIDTH, y: 0 }}
      >
        <View style={styles.page}><SettingsScreen /></View>
        <View style={styles.page}>
          <HomeScreen
            onBackgroundPress={handleRecordBackgroundPress}
            onTranscriptPending={handleTranscriptPending}
            onTranscript={handleTranscript}
            onRecordingChange={setIsRecordingActive}
          />
        </View>
        <View style={styles.page}><AlertsScreen entries={alertEntries} /></View>
      </ScrollView>

      {/* Bottom Nav */}
      <Animated.View
        style={[
          styles.navBar,
          navBarAnimatedStyle,
        ]}
      >
        {TABS.map((tab, i) => {
          const IconComponent = getTabIcon(i, isRecordingActive);
          const iconColor =
            i === RECORD_TAB_INDEX && isRecordingActive ? RECORD_ACTIVE_COLOR : INACTIVE_COLOR;
          return (
            <Pressable
              key={tab.key}
              onPress={() => handleTabPress(i)}
              style={styles.navItem}
            >
              <IconComponent size={28} color={iconColor} />
            </Pressable>
          );
        })}

        <Animated.View
          pointerEvents="none"
          style={[
            styles.activeIndicator,
            {
              width: indicatorWidth,
              transform: [{ translateX: indicatorTranslateX }],
            },
          ]}
        >
          <Animated.View
            style={[
              styles.indicatorIconTrack,
              {
                transform: [{ translateX: indicatorIconTranslateX }],
              },
            ]}
          >
            {TABS.map((tab, i) => {
              const IconComponent = getTabIcon(i, isRecordingActive);
              const iconColor =
                i === RECORD_TAB_INDEX && isRecordingActive
                  ? RECORD_ACTIVE_COLOR
                  : SELECTED_ICON_COLOR;

              return (
              <View key={`${tab.key}-selected`} style={styles.indicatorIconSlot}>
                <IconComponent size={28} color={iconColor} />
              </View>
              );
            })}
          </Animated.View>
        </Animated.View>
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
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
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
  activeIndicator: {
    position: "absolute",
    left: NAV_HORIZONTAL_PADDING + INDICATOR_HORIZONTAL_INSET,
    top: INDICATOR_MARGIN,
    width: INDICATOR_WIDTH,
    height: NAV_HEIGHT - INDICATOR_MARGIN * 2,
    borderRadius: 999,
    backgroundColor: ACTIVE_COLOR,
    overflow: "hidden",
    justifyContent: "center",
    zIndex: 2,
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
  navItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
  },
});
