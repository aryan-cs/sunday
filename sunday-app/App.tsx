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
import { AlertsScreen } from "./src/screens/AlertsScreen";
import { SettingsIcon, RecordIcon, AlertIcon } from "./src/components/NavIcons";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const BACKGROUND = "#121212";
const DOT_COLOR = "#ffffff";
const RECORDING_COLOR = "#eb4034";
const NAV_HEIGHT = 60;
const NAV_SIDE_INSET = 24;
const NAV_HORIZONTAL_PADDING = 10;
const INDICATOR_MARGIN = 6;
const INDICATOR_HORIZONTAL_INSET = 4;
const ACTIVE_COLOR = "#ffffff";
const SELECTED_ICON_COLOR = BACKGROUND;
const INACTIVE_COLOR = "#f4f4f4";

// Order: Settings (0) — Record (1) — Alerts (2)
// Record starts as the active/center screen.
const TABS = [
  { key: "settings", Icon: SettingsIcon },
  { key: "record", Icon: RecordIcon },
  { key: "alerts", Icon: AlertIcon },
] as const;

const INITIAL_INDEX = 1;
const NAV_WIDTH = SCREEN_WIDTH - NAV_SIDE_INSET * 2;
const NAV_CONTENT_WIDTH = NAV_WIDTH - NAV_HORIZONTAL_PADDING * 2;
const NAV_ITEM_WIDTH = (NAV_WIDTH - NAV_HORIZONTAL_PADDING * 2) / TABS.length;
const INDICATOR_WIDTH = NAV_ITEM_WIDTH - INDICATOR_HORIZONTAL_INSET * 2;
const INDICATOR_EDGE_EXTENSION = 8;
const RECORD_TAB_INDEX = 1;
const CENTER_DOT_SIZE = SCREEN_WIDTH * 0.5;
const CORNER_DOT_SIZE = 52;
const DOT_BOUNCE_X = 10;
const DOT_BOUNCE_Y = 7;

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

function Main() {
  const insets = useSafeAreaInsets();
  const scrollRef = React.useRef<ScrollView>(null);
  const scrollX = React.useRef(new Animated.Value(INITIAL_INDEX * SCREEN_WIDTH)).current;
  const navTranslateY = React.useRef(new Animated.Value(0)).current;
  const dotBounceX = React.useRef(new Animated.Value(0)).current;
  const dotBounceY = React.useRef(new Animated.Value(0)).current;
  const dotBounceScale = React.useRef(new Animated.Value(1)).current;
  const previousIndexRef = React.useRef(INITIAL_INDEX);
  const [activeIndex, setActiveIndex] = React.useState(INITIAL_INDEX);
  const [isRecording, setIsRecording] = React.useState(false);
  const [navVisible, setNavVisible] = React.useState(true);
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
  const dotCenterLeft = (SCREEN_WIDTH - CENTER_DOT_SIZE) / 2;
  const dotCenterTop = (SCREEN_HEIGHT - CENTER_DOT_SIZE) / 2;
  const dotCornerLeft = SCREEN_WIDTH - NAV_SIDE_INSET - CORNER_DOT_SIZE;
  const dotCornerTop = insets.top + 14;
  const dotLeft = React.useMemo(
    () =>
      scrollX.interpolate({
        inputRange: [0, SCREEN_WIDTH, SCREEN_WIDTH * 2],
        outputRange: isRecording
          ? [dotCornerLeft, dotCenterLeft, dotCornerLeft]
          : [dotCenterLeft, dotCenterLeft, dotCenterLeft],
        extrapolate: "clamp",
      }),
    [dotCenterLeft, dotCornerLeft, isRecording, scrollX],
  );
  const dotTop = React.useMemo(
    () =>
      scrollX.interpolate({
        inputRange: [0, SCREEN_WIDTH, SCREEN_WIDTH * 2],
        outputRange: isRecording
          ? [dotCornerTop, dotCenterTop, dotCornerTop]
          : [dotCenterTop, dotCenterTop, dotCenterTop],
        extrapolate: "clamp",
      }),
    [dotCenterTop, dotCornerTop, isRecording, scrollX],
  );
  const dotSize = React.useMemo(
    () =>
      scrollX.interpolate({
        inputRange: [0, SCREEN_WIDTH, SCREEN_WIDTH * 2],
        outputRange: isRecording
          ? [CORNER_DOT_SIZE, CENTER_DOT_SIZE, CORNER_DOT_SIZE]
          : [CENTER_DOT_SIZE, CENTER_DOT_SIZE, CENTER_DOT_SIZE],
        extrapolate: "clamp",
      }),
    [isRecording, scrollX],
  );
  const animatedDotLeft = React.useMemo(
    () => Animated.add(dotLeft, dotBounceX),
    [dotBounceX, dotLeft],
  );
  const animatedDotTop = React.useMemo(
    () => Animated.add(dotTop, dotBounceY),
    [dotBounceY, dotTop],
  );

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

  const playRecordingDotBounce = React.useCallback(
    (toRecordPage: boolean) => {
      dotBounceX.stopAnimation();
      dotBounceY.stopAnimation();
      dotBounceScale.stopAnimation();

      const xTarget = toRecordPage ? -DOT_BOUNCE_X : DOT_BOUNCE_X;
      const yTarget = toRecordPage ? DOT_BOUNCE_Y : -DOT_BOUNCE_Y;
      const scaleTarget = toRecordPage ? 1.08 : 0.92;

      Animated.sequence([
        Animated.parallel([
          Animated.timing(dotBounceX, {
            toValue: xTarget,
            duration: 95,
            useNativeDriver: false,
          }),
          Animated.timing(dotBounceY, {
            toValue: yTarget,
            duration: 95,
            useNativeDriver: false,
          }),
          Animated.timing(dotBounceScale, {
            toValue: scaleTarget,
            duration: 95,
            useNativeDriver: false,
          }),
        ]),
        Animated.parallel([
          Animated.spring(dotBounceX, {
            toValue: 0,
            speed: 18,
            bounciness: 10,
            useNativeDriver: false,
          }),
          Animated.spring(dotBounceY, {
            toValue: 0,
            speed: 18,
            bounciness: 10,
            useNativeDriver: false,
          }),
          Animated.spring(dotBounceScale, {
            toValue: 1,
            speed: 18,
            bounciness: 10,
            useNativeDriver: false,
          }),
        ]),
      ]).start();
    },
    [dotBounceScale, dotBounceX, dotBounceY],
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

  const handleRecordingToggle = React.useCallback(() => {
    setIsRecording((current) => !current);
  }, []);

  React.useEffect(() => {
    if (activeIndex !== RECORD_TAB_INDEX && !navVisible) {
      animateNavVisibility(true);
    }
  }, [activeIndex, animateNavVisibility, navVisible]);

  React.useEffect(() => {
    const previousIndex = previousIndexRef.current;
    if (isRecording && previousIndex !== activeIndex) {
      playRecordingDotBounce(activeIndex === RECORD_TAB_INDEX);
    }
    previousIndexRef.current = activeIndex;
  }, [activeIndex, isRecording, playRecordingDotBounce]);

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
            isRecording={isRecording}
            onBackgroundPress={handleRecordBackgroundPress}
            onToggleRecording={handleRecordingToggle}
          />
        </View>
        <View style={styles.page}><AlertsScreen /></View>
      </ScrollView>

      <Animated.View
        pointerEvents={isRecording ? "auto" : "none"}
        style={[
          styles.recordDotFrame,
          {
            opacity: isRecording ? 1 : 0,
            width: dotSize,
            height: dotSize,
            left: animatedDotLeft,
            top: animatedDotTop,
            transform: [{ scale: dotBounceScale }],
          },
        ]}
      >
        <Pressable onPress={handleRecordingToggle} style={styles.recordDotTapTarget}>
          <View
            style={[
              styles.recordDot,
              { backgroundColor: isRecording ? RECORDING_COLOR : DOT_COLOR },
            ]}
          />
        </Pressable>
      </Animated.View>

      {/* Bottom Nav */}
      <Animated.View
        style={[
          styles.navBar,
          navBarAnimatedStyle,
        ]}
      >
        {TABS.map((tab, i) => {
          return (
            <Pressable
              key={tab.key}
              onPress={() => handleTabPress(i)}
              style={styles.navItem}
            >
              <tab.Icon size={28} color={INACTIVE_COLOR} />
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
            {TABS.map((tab) => (
              <View key={`${tab.key}-selected`} style={styles.indicatorIconSlot}>
                <tab.Icon size={28} color={SELECTED_ICON_COLOR} />
              </View>
            ))}
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
  recordDotFrame: {
    position: "absolute",
    zIndex: 5,
  },
  recordDotTapTarget: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  recordDot: {
    width: "100%",
    height: "100%",
    borderRadius: 999,
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
