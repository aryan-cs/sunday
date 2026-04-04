import React from "react";
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
const BACKGROUND = "#121212";
const NAV_HEIGHT = 60;
const NAV_SIDE_INSET = 24;
const NAV_HORIZONTAL_PADDING = 10;
const INDICATOR_MARGIN = 6;
const INDICATOR_HORIZONTAL_INSET = 12;
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
const INDICATOR_OVERSHOOT = 10;
const RECORD_TAB_INDEX = 1;

function Main() {
  const insets = useSafeAreaInsets();
  const scrollRef = React.useRef<ScrollView>(null);
  const indicatorTranslateX = React.useRef(new Animated.Value(INITIAL_INDEX * NAV_ITEM_WIDTH)).current;
  const navTranslateY = React.useRef(new Animated.Value(0)).current;
  const [activeIndex, setActiveIndex] = React.useState(INITIAL_INDEX);
  const [navVisible, setNavVisible] = React.useState(true);
  const indicatorIconTranslateX = React.useMemo(
    () => Animated.multiply(indicatorTranslateX, -1),
    [indicatorTranslateX],
  );
  const navHiddenOffset = NAV_HEIGHT + Math.max(insets.bottom, 14) + 18;

  const animateIndicatorToIndex = React.useCallback(
    (index: number) => {
      const target = index * NAV_ITEM_WIDTH;
      const maxOffset = (TABS.length - 1) * NAV_ITEM_WIDTH;

      indicatorTranslateX.stopAnimation((currentValue: number) => {
        if (Math.abs(target - currentValue) < 0.5) {
          return;
        }

        const direction = target >= currentValue ? 1 : -1;
        const overshoot = Math.min(
          maxOffset,
          Math.max(0, target + direction * INDICATOR_OVERSHOOT),
        );

        Animated.sequence([
          Animated.timing(indicatorTranslateX, {
            toValue: overshoot,
            duration: 150,
            useNativeDriver: true,
          }),
          Animated.spring(indicatorTranslateX, {
            toValue: target,
            speed: 20,
            bounciness: 10,
            useNativeDriver: true,
          }),
        ]).start();
      });
    },
    [indicatorTranslateX],
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
            useNativeDriver: true,
          }),
          Animated.spring(navTranslateY, {
            toValue: target,
            speed: 19,
            bounciness: 9,
            useNativeDriver: true,
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
      animateIndicatorToIndex(index);
      scrollRef.current?.scrollTo({ x: index * SCREEN_WIDTH, animated: true });
    },
    [animateIndicatorToIndex, animateNavVisibility, navVisible],
  );

  const handleMomentumEnd = React.useCallback(
    (e: any) => {
      const page = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
      if (page === activeIndex) {
        return;
      }
      setActiveIndex(page);
      animateIndicatorToIndex(page);
      if (page !== RECORD_TAB_INDEX && !navVisible) {
        animateNavVisibility(true);
      }
    },
    [activeIndex, animateIndicatorToIndex, animateNavVisibility, navVisible],
  );

  const handleRecordBackgroundPress = React.useCallback(() => {
    if (activeIndex !== RECORD_TAB_INDEX) {
      return;
    }
    animateNavVisibility(!navVisible);
  }, [activeIndex, animateNavVisibility, navVisible]);

  React.useEffect(() => {
    if (activeIndex !== RECORD_TAB_INDEX && !navVisible) {
      animateNavVisibility(true);
    }
  }, [activeIndex, animateNavVisibility, navVisible]);

  React.useEffect(() => {
    if (!navVisible) {
      navTranslateY.setValue(navHiddenOffset);
    }
  }, [navHiddenOffset, navTranslateY, navVisible]);

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
        onMomentumScrollEnd={handleMomentumEnd}
        contentOffset={{ x: INITIAL_INDEX * SCREEN_WIDTH, y: 0 }}
      >
        <View style={styles.page}><SettingsScreen /></View>
        <View style={styles.page}><HomeScreen onBackgroundPress={handleRecordBackgroundPress} /></View>
        <View style={styles.page}><AlertsScreen /></View>
      </ScrollView>

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
