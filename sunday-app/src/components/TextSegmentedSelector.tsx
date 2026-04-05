import React from "react";
import {
  Animated,
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

const BACKGROUND = "#121212";
const CONTAINER = "#252525";
const ACTIVE = "#ffffff";
const INACTIVE_TEXT = "#f4f4f4";
const ACTIVE_TEXT = BACKGROUND;
const PADDING = 4;
const INDICATOR_GAP = 2;

type TextSegmentedSelectorProps = {
  options: readonly string[];
  value: string;
  onChange: (nextValue: string) => void;
  onInteractionChange?: (isInteracting: boolean) => void;
};

export function TextSegmentedSelector({
  options,
  value,
  onChange,
  onInteractionChange,
}: TextSegmentedSelectorProps) {
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option === value),
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
  const itemWidth = innerWidth / options.length || 0;
  const indicatorWidth = Math.max(0, itemWidth - INDICATOR_GAP * 2);
  const indicatorInset = Math.max(0, (itemWidth - indicatorWidth) / 2);
  const clampIndex = React.useCallback(
    (nextIndex: number) => Math.max(0, Math.min(options.length - 1, nextIndex)),
    [options.length],
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
        inputRange: options.map((_, index) => index),
        outputRange: options.map((_, index) => index * itemWidth),
        extrapolate: "clamp",
      }),
    [animatedIndex, itemWidth, options],
  );
  const indicatorTextTranslateX = React.useMemo(
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
        onChange(options[roundedIndex]);
      }
    },
    [animatedIndex, clampIndex, onChange, options, selectedIndex],
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
      {options.map((option) => (
        <Pressable
          key={option}
          onPress={() => {
            setInteractionActive(false);
            onChange(option);
          }}
          style={styles.optionButton}
        >
          <Text
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            numberOfLines={1}
            style={styles.optionText}
          >
            {option}
          </Text>
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
                styles.indicatorTextTrack,
                {
                  left: -indicatorInset,
                  width: innerWidth,
                  transform: [{ translateX: indicatorTextTranslateX }],
                },
              ]}
            >
              {options.map((option) => (
                <View key={`${option}-selected`} style={[styles.optionButton, styles.optionSlot]}>
                  <Text
                    adjustsFontSizeToFit
                    minimumFontScale={0.8}
                    numberOfLines={1}
                    style={[styles.optionText, styles.optionTextSelected]}
                  >
                    {option}
                  </Text>
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
    paddingHorizontal: 3,
  },
  optionSlot: {
    width: "auto",
  },
  optionText: {
    color: INACTIVE_TEXT,
    fontSize: 11,
    fontWeight: "600",
    textAlign: "center",
  },
  optionTextSelected: {
    color: ACTIVE_TEXT,
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
  indicatorTextTrack: {
    position: "absolute",
    top: 0,
    bottom: 0,
    flexDirection: "row",
    alignItems: "center",
  },
});
