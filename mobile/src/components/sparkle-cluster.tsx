import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

export type SparkleClusterProps = {
  /** Outer diameter of parent orb core */
  size: number;
};

/**
 * Dynamic Sparkle Cluster (Feature 10.1)
 *
 * An animated cluster of twinkling stars for the "Planning your day..." thinking stage.
 * Features a central spinning golden starburst surrounded by 4 satellite sparkles
 * that pulse, twinkle, and glint dynamically out of phase on the GPU.
 */
export function SparkleCluster({ size }: SparkleClusterProps) {
  // Center main star rotation and pulse
  const centerRotate = useSharedValue(0);
  const centerScale = useSharedValue(0.85);

  // 4 satellite stars out-of-phase scale and opacities
  const star1Scale = useSharedValue(0.3);
  const star1Opacity = useSharedValue(0.3);

  const star2Scale = useSharedValue(0.25);
  const star2Opacity = useSharedValue(0.4);

  const star3Scale = useSharedValue(0.35);
  const star3Opacity = useSharedValue(0.35);

  const star4Scale = useSharedValue(0.2);
  const star4Opacity = useSharedValue(0.3);

  useEffect(() => {
    // Center star: Continuous 360-degree rotation
    centerRotate.value = 0;
    centerRotate.value = withRepeat(
      withTiming(360, { duration: 1100, easing: Easing.linear }),
      -1,
      false,
    );

    // Center star: Dynamic scale pulse
    centerScale.value = 0.85;
    centerScale.value = withRepeat(
      withTiming(1.25, { duration: 450, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );

    // Star 1 (Top-Right): Fast twinkle (380ms)
    star1Scale.value = 0.3;
    star1Scale.value = withRepeat(
      withTiming(1.15, { duration: 380, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    star1Opacity.value = 0.3;
    star1Opacity.value = withRepeat(
      withTiming(1.0, { duration: 380, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );

    // Star 2 (Bottom-Left): Medium twinkle (490ms)
    star2Scale.value = 0.25;
    star2Scale.value = withRepeat(
      withTiming(1.1, { duration: 490, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    star2Opacity.value = 0.4;
    star2Opacity.value = withRepeat(
      withTiming(1.0, { duration: 490, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );

    // Star 3 (Top-Left): Shimmering star (430ms)
    star3Scale.value = 0.3;
    star3Scale.value = withRepeat(
      withTiming(1.2, { duration: 430, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    star3Opacity.value = 0.3;
    star3Opacity.value = withRepeat(
      withTiming(0.95, { duration: 430, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );

    // Star 4 (Bottom-Right): Glint star (560ms)
    star4Scale.value = 0.2;
    star4Scale.value = withRepeat(
      withTiming(1.05, { duration: 560, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    star4Opacity.value = 0.3;
    star4Opacity.value = withRepeat(
      withTiming(1.0, { duration: 560, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [
    centerRotate,
    centerScale,
    star1Scale,
    star1Opacity,
    star2Scale,
    star2Opacity,
    star3Scale,
    star3Opacity,
    star4Scale,
    star4Opacity,
  ]);

  const centerAnimStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      transform: [
        { rotate: `${centerRotate.value}deg` },
        { scale: centerScale.value },
      ],
    };
  });

  const star1AnimStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      transform: [{ scale: star1Scale.value }],
      opacity: star1Opacity.value,
    };
  });

  const star2AnimStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      transform: [{ scale: star2Scale.value }],
      opacity: star2Opacity.value,
    };
  });

  const star3AnimStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      transform: [{ scale: star3Scale.value }],
      opacity: star3Opacity.value,
    };
  });

  const star4AnimStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      transform: [{ scale: star4Scale.value }],
      opacity: star4Opacity.value,
    };
  });

  const containerSize = size * 0.72;

  return (
    <View
      style={[
        styles.container,
        { width: containerSize, height: containerSize },
      ]}
      pointerEvents="none"
    >
      {/* Central Rotating Main Star */}
      <Animated.View style={[styles.centerStar, centerAnimStyle]}>
        <Text style={[styles.starEmoji, { fontSize: size * 0.44 }]}>✨</Text>
      </Animated.View>

      {/* Satellite Sparkle 1: Top-Right */}
      <Animated.View
        style={[
          styles.satellite,
          { top: 2, right: 4 },
          star1AnimStyle,
        ]}
      >
        <Text style={[styles.satelliteText, { fontSize: size * 0.22 }]}>✦</Text>
      </Animated.View>

      {/* Satellite Sparkle 2: Bottom-Left */}
      <Animated.View
        style={[
          styles.satellite,
          { bottom: 4, left: 3 },
          star2AnimStyle,
        ]}
      >
        <Text style={[styles.satelliteText, { fontSize: size * 0.20 }]}>✦</Text>
      </Animated.View>

      {/* Satellite Sparkle 3: Top-Left */}
      <Animated.View
        style={[
          styles.satellite,
          { top: 4, left: 5 },
          star3AnimStyle,
        ]}
      >
        <Text style={[styles.satelliteTextSmall, { fontSize: size * 0.16 }]}>⋆</Text>
      </Animated.View>

      {/* Satellite Sparkle 4: Bottom-Right */}
      <Animated.View
        style={[
          styles.satellite,
          { bottom: 3, right: 6 },
          star4AnimStyle,
        ]}
      >
        <Text style={[styles.satelliteText, { fontSize: size * 0.19 }]}>✦</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  centerStar: {
    alignItems: "center",
    justifyContent: "center",
  },
  starEmoji: {
    textAlign: "center",
  },
  satellite: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  satelliteText: {
    color: "#FEF08A", // Bright Golden Shimmer
    fontWeight: "900",
    textShadowColor: "rgba(252, 211, 77, 0.8)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 4,
  },
  satelliteTextSmall: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
});
