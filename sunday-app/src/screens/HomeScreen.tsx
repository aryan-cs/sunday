import React, { useCallback, useRef } from "react";
import { Animated, Pressable, StatusBar, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useVideoPlayer, VideoView } from "expo-video";

const BACKGROUND = "#000000";
const ORB_VIDEO_URL =
  "https://www.apple.com/105/media/us/siri/2018/ee7c4c16_aae5_4678_9cdd_7ca813baf929/films/siri_orb_large.mp4";

export function HomeScreen() {
  const orbScale = useRef(new Animated.Value(1)).current;
  const orbLift = useRef(new Animated.Value(0)).current;

  const player = useVideoPlayer(ORB_VIDEO_URL, (videoPlayer) => {
    videoPlayer.loop = true;
    videoPlayer.muted = true;
    videoPlayer.play();
  });

  const animateOrb = useCallback(() => {
    orbScale.stopAnimation();
    orbLift.stopAnimation();

    Animated.parallel([
      Animated.sequence([
        Animated.spring(orbScale, {
          toValue: 1.16,
          friction: 4.5,
          tension: 165,
          useNativeDriver: true,
        }),
        Animated.spring(orbScale, {
          toValue: 0.98,
          friction: 5.5,
          tension: 150,
          useNativeDriver: true,
        }),
        Animated.spring(orbScale, {
          toValue: 1,
          friction: 6,
          tension: 115,
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.spring(orbLift, {
          toValue: -8,
          friction: 5,
          tension: 160,
          useNativeDriver: true,
        }),
        Animated.spring(orbLift, {
          toValue: 2,
          friction: 6,
          tension: 120,
          useNativeDriver: true,
        }),
        Animated.spring(orbLift, {
          toValue: 0,
          friction: 6,
          tension: 110,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [orbLift, orbScale]);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <View style={styles.container}>
        <Pressable onPress={animateOrb} style={styles.pressable} hitSlop={24}>
          <Animated.View
            style={[
              styles.orbFrame,
              {
                transform: [{ translateY: orbLift }, { scale: orbScale }],
              },
            ]}
          >
            <VideoView
              player={player}
              nativeControls={false}
              allowsFullscreen={false}
              allowsPictureInPicture={false}
              contentFit="cover"
              style={styles.orbVideo}
            />
          </Animated.View>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BACKGROUND,
  },
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BACKGROUND,
  },
  pressable: {
    alignItems: "center",
    justifyContent: "center",
  },
  orbFrame: {
    width: 170,
    height: 170,
    borderRadius: 85,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#6bb7ff",
    shadowOpacity: 0.22,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
  },
  orbVideo: {
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: "transparent",
  },
});
