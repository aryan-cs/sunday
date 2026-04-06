import React from "react";
import { Animated, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { FONTS } from "../constants/fonts";

export const COACH_DELAY_MS = 20_000;

type CoachAction = {
  label: string;
  onPress: () => void;
  tone?: "primary" | "secondary";
};

type PageCoachOverlayProps = {
  visible: boolean;
  eyebrow?: string;
  title: string;
  body?: string;
  steps?: string[];
  primaryAction?: CoachAction;
  secondaryAction?: CoachAction;
  highlightPrimaryAfterMs?: number;
  onDismiss: () => void;
};

type UseDelayedCoachOptions = {
  showImmediately?: boolean;
};

export function useDelayedCoach(
  active: boolean,
  delayMs: number = COACH_DELAY_MS,
  options: UseDelayedCoachOptions = {},
) {
  const [visible, setVisible] = React.useState(false);
  const dismissedRef = React.useRef(false);
  const { showImmediately = false } = options;

  React.useEffect(() => {
    if (!active) {
      dismissedRef.current = false;
      setVisible(false);
      return;
    }

    dismissedRef.current = false;
    if (showImmediately) {
      setVisible(true);
      return;
    }

    setVisible(false);

    const timeout = setTimeout(() => {
      if (!dismissedRef.current) {
        setVisible(true);
      }
    }, delayMs);

    return () => clearTimeout(timeout);
  }, [active, delayMs, showImmediately]);

  const dismiss = React.useCallback(() => {
    dismissedRef.current = true;
    setVisible(false);
  }, []);

  return { visible, dismiss };
}

export function PageCoachOverlay({
  visible,
  eyebrow = "Need a hint?",
  title,
  body,
  steps = [],
  primaryAction,
  secondaryAction,
  highlightPrimaryAfterMs = COACH_DELAY_MS,
  onDismiss,
}: PageCoachOverlayProps) {
  const [isPrimaryHighlighted, setIsPrimaryHighlighted] = React.useState(false);
  const pulse = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    setIsPrimaryHighlighted(false);
    pulse.stopAnimation();
    pulse.setValue(0);

    if (!visible || !primaryAction) {
      return;
    }

    const timeout = setTimeout(() => {
      setIsPrimaryHighlighted(true);
    }, highlightPrimaryAfterMs);

    return () => clearTimeout(timeout);
  }, [highlightPrimaryAfterMs, primaryAction, pulse, visible]);

  React.useEffect(() => {
    if (!isPrimaryHighlighted) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 850,
          useNativeDriver: false,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 850,
          useNativeDriver: false,
        }),
      ]),
    );

    animation.start();
    return () => {
      animation.stop();
      pulse.stopAnimation();
      pulse.setValue(0);
    };
  }, [isPrimaryHighlighted, pulse]);

  if (!visible) {
    return null;
  }

  return (
    <View pointerEvents="box-none" style={styles.overlayRoot}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onDismiss} />
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.eyebrow}>{eyebrow}</Text>
          <Pressable hitSlop={10} onPress={onDismiss}>
            <Text style={styles.dismissText}>Hide</Text>
          </Pressable>
        </View>
        <Text style={styles.title}>{title}</Text>
        {body ? <Text style={styles.body}>{body}</Text> : null}
        {steps.length ? (
          <View style={styles.steps}>
            {steps.map((step) => (
              <Text key={step} style={styles.step}>
                {step}
              </Text>
            ))}
          </View>
        ) : null}
        {primaryAction || secondaryAction ? (
          <View style={styles.actions}>
            {secondaryAction ? (
              <Pressable
                style={[styles.button, styles.secondaryButton]}
                onPress={() => {
                  onDismiss();
                  secondaryAction.onPress();
                }}
              >
                <Text style={[styles.buttonText, styles.secondaryButtonText]}>
                  {secondaryAction.label}
                </Text>
              </Pressable>
            ) : null}
            {primaryAction ? (
              <View style={styles.primaryActionWrap}>
                {isPrimaryHighlighted ? (
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.primaryButtonHalo,
                      {
                        opacity: pulse.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.35, 0.85],
                        }),
                        transform: [
                          {
                            scale: pulse.interpolate({
                              inputRange: [0, 1],
                              outputRange: [1, 1.08],
                            }),
                          },
                        ],
                      },
                    ]}
                  />
                ) : null}
                <Pressable
                  style={[styles.button, styles.primaryButton]}
                  onPress={() => {
                    onDismiss();
                    primaryAction.onPress();
                  }}
                >
                  <Text style={[styles.buttonText, styles.primaryButtonText]}>
                    {primaryAction.label}
                  </Text>
                </Pressable>
                {isPrimaryHighlighted ? <Text style={styles.primaryHint}>Tap here</Text> : null}
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlayRoot: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    paddingHorizontal: 18,
    paddingBottom: Platform.OS === "web" ? 104 : 120,
  },
  card: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 640,
    borderRadius: 24,
    backgroundColor: "rgba(28, 28, 28, 0.96)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 10,
    shadowColor: "#000000",
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  eyebrow: {
    color: "#8ab4ff",
    fontFamily: FONTS.semibold,
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  dismissText: {
    color: "#8b8b8b",
    fontFamily: FONTS.medium,
    fontSize: 13,
  },
  title: {
    color: "#ffffff",
    fontFamily: FONTS.bold,
    fontSize: Platform.OS === "web" ? 24 : 22,
    lineHeight: Platform.OS === "web" ? 30 : 28,
  },
  body: {
    color: "#d2d2d2",
    fontFamily: FONTS.regular,
    fontSize: 15,
    lineHeight: 22,
  },
  steps: {
    gap: 6,
  },
  step: {
    color: "#f0f0f0",
    fontFamily: FONTS.medium,
    fontSize: 15,
    lineHeight: 22,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 2,
  },
  button: {
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  primaryActionWrap: {
    position: "relative",
    alignItems: "flex-start",
  },
  primaryButtonHalo: {
    position: "absolute",
    top: -6,
    left: -6,
    right: -6,
    bottom: -6,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "#8ab4ff",
    shadowColor: "#8ab4ff",
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  primaryButton: {
    backgroundColor: "#ffffff",
  },
  secondaryButton: {
    backgroundColor: "#2b2b2b",
    borderWidth: 1,
    borderColor: "#3b3b3b",
  },
  buttonText: {
    fontFamily: FONTS.semibold,
    fontSize: 15,
  },
  primaryButtonText: {
    color: "#121212",
  },
  primaryHint: {
    marginTop: 8,
    color: "#8ab4ff",
    fontFamily: FONTS.semibold,
    fontSize: 13,
  },
  secondaryButtonText: {
    color: "#ffffff",
  },
});
