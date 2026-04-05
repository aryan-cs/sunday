import React from "react";
import {
  Animated,
  LayoutChangeEvent,
  PanResponder,
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
const PADDING = 4;
const INDICATOR_GAP = 2;

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
  onInteractionChange?: (isInteracting: boolean) => void;
};

export function TravelTypeSelector({
  value,
  onChange,
  onInteractionChange,
}: TravelTypeSelectorProps) {
  const selectedIndex = Math.max(
    0,
    OPTIONS.findIndex((option) => option.key === value),
  );
  const animatedIndex = React.useRef(new Animated.Value(selectedIndex)).current;
  const [containerWidth, setContainerWidth] = React.useState(0);
  const isDraggingRef = React.useRef(false);
  const dragIndexRef = React.useRef(selectedIndex);
  const isTouchActiveRef = React.useRef(false);

  React.useEffect(() => {
    if (isDraggingRef.current) {
      return;
    }
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
  const clampIndex = React.useCallback(
    (nextIndex: number) => Math.max(0, Math.min(OPTIONS.length - 1, nextIndex)),
    [],
  );
  const getDragIndex = React.useCallback(
    (locationX: number) => {
      if (itemWidth <= 0) {
        return selectedIndex;
      }
      return clampIndex((locationX - PADDING - itemWidth / 2) / itemWidth);
    },
    [clampIndex, itemWidth, selectedIndex],
  );
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
  const finishDrag = React.useCallback(
    (nextIndex: number) => {
      isDraggingRef.current = false;
      dragIndexRef.current = nextIndex;
      const roundedIndex = clampIndex(Math.round(nextIndex));
      Animated.spring(animatedIndex, {
        toValue: roundedIndex,
        speed: 20,
        bounciness: 10,
        useNativeDriver: false,
      }).start();
      if (roundedIndex !== selectedIndex) {
        onChange(OPTIONS[roundedIndex].key);
      }
    },
    [animatedIndex, clampIndex, onChange, selectedIndex],
  );
  const setInteractionActive = React.useCallback(
    (isInteracting: boolean) => {
      if (isTouchActiveRef.current === isInteracting) {
        return;
      }
      isTouchActiveRef.current = isInteracting;
      onInteractionChange?.(isInteracting);
    },
    [onInteractionChange],
  );
  const panResponder = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderGrant: (event) => {
          setInteractionActive(true);
          isDraggingRef.current = true;
          const nextIndex = getDragIndex(event.nativeEvent.locationX);
          dragIndexRef.current = nextIndex;
          animatedIndex.stopAnimation();
          animatedIndex.setValue(nextIndex);
        },
        onPanResponderMove: (event) => {
          const nextIndex = getDragIndex(event.nativeEvent.locationX);
          dragIndexRef.current = nextIndex;
          animatedIndex.setValue(nextIndex);
        },
        onPanResponderRelease: () => {
          setInteractionActive(false);
          finishDrag(dragIndexRef.current);
        },
        onPanResponderTerminate: () => {
          setInteractionActive(false);
          finishDrag(dragIndexRef.current);
        },
      }),
    [animatedIndex, finishDrag, getDragIndex, setInteractionActive],
  );

  return (
    <View
      style={styles.container}
      onLayout={handleLayout}
      {...panResponder.panHandlers}
    >
      {OPTIONS.map((option) => (
        <Pressable
          key={option.key}
          onPress={() => {
            setInteractionActive(false);
            onChange(option.key);
          }}
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
    minHeight: 42,
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
    height: 34,
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
