import React from "react";
import {
  Animated,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import {
  BikeTravelIcon,
  DriveTravelIcon,
  TransitTravelIcon,
  WalkTravelIcon,
} from "./NavIcons";

const BACKGROUND = "#121212";
const CONTAINER = "#252525";
const ACTIVE = "#ffffff";
const INACTIVE_ICON = "#f4f4f4";
const ACTIVE_ICON = BACKGROUND;
const PADDING = 8;
const INDICATOR_GAP = 4;

const OPTIONS = [
  { key: "driving", Icon: DriveTravelIcon },
  { key: "walking", Icon: WalkTravelIcon },
  { key: "bicycling", Icon: BikeTravelIcon },
  { key: "transit", Icon: TransitTravelIcon },
] as const;

type TravelType = (typeof OPTIONS)[number]["key"];

type TravelTypeSelectorProps = {
  value: string;
  onChange: (nextValue: TravelType) => void;
};

export function TravelTypeSelector({ value, onChange }: TravelTypeSelectorProps) {
  const selectedIndex = Math.max(
    0,
    OPTIONS.findIndex((option) => option.key === value),
  );
  const animatedIndex = React.useRef(new Animated.Value(selectedIndex)).current;
  const [containerWidth, setContainerWidth] = React.useState(0);

  React.useEffect(() => {
    Animated.spring(animatedIndex, {
      toValue: selectedIndex,
      speed: 20,
      bounciness: 10,
      useNativeDriver: false,
    }).start();
  }, [animatedIndex, selectedIndex]);

  const handleLayout = React.useCallback((event: LayoutChangeEvent) => {
    setContainerWidth(event.nativeEvent.layout.width);
  }, []);

  const innerWidth = Math.max(0, containerWidth - PADDING * 2);
  const itemWidth = innerWidth / OPTIONS.length || 0;
  const indicatorWidth = Math.max(0, itemWidth - INDICATOR_GAP * 2);
  const indicatorInset = Math.max(0, (itemWidth - indicatorWidth) / 2);
  const indicatorTranslateX = React.useMemo(
    () =>
      animatedIndex.interpolate({
        inputRange: OPTIONS.map((_, index) => index),
        outputRange: OPTIONS.map((_, index) => index * itemWidth),
        extrapolate: "clamp",
      }),
    [animatedIndex, itemWidth],
  );
  const indicatorIconTranslateX = React.useMemo(
    () => Animated.multiply(indicatorTranslateX, -1),
    [indicatorTranslateX],
  );

  return (
    <View style={styles.container} onLayout={handleLayout}>
      {OPTIONS.map((option) => (
        <Pressable
          key={option.key}
          onPress={() => onChange(option.key)}
          style={styles.optionButton}
        >
          <option.Icon size={24} color={INACTIVE_ICON} />
        </Pressable>
      ))}

      {itemWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.activeIndicatorShadow,
            {
              left: PADDING + indicatorInset,
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
                  left: -indicatorInset,
                  width: innerWidth,
                  transform: [{ translateX: indicatorIconTranslateX }],
                },
              ]}
            >
              {OPTIONS.map((option) => (
                <View key={`${option.key}-selected`} style={[styles.optionButton, styles.optionSlot]}>
                  <option.Icon size={24} color={ACTIVE_ICON} />
                </View>
              ))}
            </Animated.View>
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "relative",
    minHeight: 58,
    borderRadius: 999,
    backgroundColor: CONTAINER,
    paddingHorizontal: PADDING,
    flexDirection: "row",
    alignItems: "center",
  },
  optionButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    height: 42,
  },
  optionSlot: {
    width: "auto",
  },
  activeIndicatorShadow: {
    position: "absolute",
    top: INDICATOR_GAP,
    bottom: INDICATOR_GAP,
    borderRadius: 999,
    shadowColor: "#ffffff",
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  activeIndicator: {
    flex: 1,
    borderRadius: 999,
    backgroundColor: ACTIVE,
    overflow: "hidden",
    justifyContent: "center",
  },
  indicatorIconTrack: {
    position: "absolute",
    top: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
  },
});
