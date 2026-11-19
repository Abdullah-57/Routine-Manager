import React, { useEffect } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import type { SharedValue } from "react-native-reanimated";

export type AudioWaveformBarsProps = {
  /** Whether audio is currently active (speech recognition or TTS playback) */
  isActive: boolean;
  /** Phase mode determining the color palette and movement cadence */
  mode?: "listening" | "speaking" | "idle";
  /** Real-time microphone audio input volume (0..1) or Reanimated SharedValue */
  audioLevel?: number | SharedValue<number>;
  /** Optional custom container style */
  style?: StyleProp<ViewStyle>;
  /** Optional custom bar color override */
  barColor?: string;
  /** Height of the waveform container (default: 32) */
  height?: number;
};

/**
 * Fluid Audio Waveform Visualizer (Feature 10.1)
 *
 * 5 vertical animated pill bars running strictly on the GPU via Reanimated worklets.
 * Follows vercel-react-native-skills `animation-gpu-properties`:
 * Animates strictly `transform: [{ scaleY }]` (zero Yoga layout recalculation, zero JS jank).
 */
export const AudioWaveformBars = React.memo(function AudioWaveformBars({
  isActive,
  mode = "listening",
  audioLevel,
  style,
  barColor,
  height = 32,
}: AudioWaveformBarsProps) {
  // 5 bar scaleY shared values (GPU-accelerated transforms)
  const scale1 = useSharedValue(0.3);
  const scale2 = useSharedValue(0.4);
  const scale3 = useSharedValue(0.5);
  const scale4 = useSharedValue(0.4);
  const scale5 = useSharedValue(0.3);

  // Main UI-thread animation loop: depends ONLY on isActive and mode
  useEffect(() => {
    if (!isActive) {
      // Quiet resting pills
      scale1.value = withTiming(0.25, { duration: 200 });
      scale2.value = withTiming(0.35, { duration: 200 });
      scale3.value = withTiming(0.45, { duration: 200 });
      scale4.value = withTiming(0.35, { duration: 200 });
      scale5.value = withTiming(0.25, { duration: 200 });
      return;
    }

    if (mode === "speaking") {
      // Energetic acoustic bounce for TTS speech output (native reversible withTiming loops)
      scale1.value = 0.25;
      scale1.value = withRepeat(
        withTiming(1.20, { duration: 170, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
      scale2.value = 0.35;
      scale2.value = withRepeat(
        withTiming(1.55, { duration: 140, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
      scale3.value = 0.45;
      scale3.value = withRepeat(
        withTiming(1.80, { duration: 190, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
      scale4.value = 0.32;
      scale4.value = withRepeat(
        withTiming(1.50, { duration: 160, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
      scale5.value = 0.22;
      scale5.value = withRepeat(
        withTiming(1.15, { duration: 180, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
      return;
    }

    // Default Listening mode:
    // Organic acoustic oscillations running continuously at 60-120fps on the GPU
    scale1.value = 0.25;
    scale1.value = withRepeat(
      withTiming(1.15, { duration: 240, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    scale2.value = 0.32;
    scale2.value = withRepeat(
      withTiming(1.45, { duration: 190, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    scale3.value = 0.40;
    scale3.value = withRepeat(
      withTiming(1.75, { duration: 270, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    scale4.value = 0.30;
    scale4.value = withRepeat(
      withTiming(1.40, { duration: 210, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    scale5.value = 0.22;
    scale5.value = withRepeat(
      withTiming(1.10, { duration: 250, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [isActive, mode, scale1, scale2, scale3, scale4, scale5]);

  // Worklet styles: 100% GPU-accelerated transform scaleY modulated by acoustic volume
  const getIntensity = () => {
    "worklet";
    if (audioLevel == null) return 1.0;
    const rawVal =
      typeof audioLevel === "number"
        ? audioLevel
        : typeof audioLevel === "object" && "value" in audioLevel
          ? audioLevel.value
          : 1.0;
    // Map microphone audio level to dynamic scaling intensity (0.35..1.85)
    return Math.max(0.35, Math.min(1.85, 0.35 + rawVal * 1.5));
  };

  const bar1Style = useAnimatedStyle(() => {
    "worklet";
    const mod = mode === "listening" ? getIntensity() * 0.9 : 1.0;
    return {
      transform: [{ scaleY: scale1.value * mod }],
    };
  });
  const bar2Style = useAnimatedStyle(() => {
    "worklet";
    const mod = mode === "listening" ? getIntensity() * 1.15 : 1.0;
    return {
      transform: [{ scaleY: scale2.value * mod }],
    };
  });
  const bar3Style = useAnimatedStyle(() => {
    "worklet";
    const mod = mode === "listening" ? getIntensity() * 1.35 : 1.0;
    return {
      transform: [{ scaleY: scale3.value * mod }],
    };
  });
  const bar4Style = useAnimatedStyle(() => {
    "worklet";
    const mod = mode === "listening" ? getIntensity() * 1.15 : 1.0;
    return {
      transform: [{ scaleY: scale4.value * mod }],
    };
  });
  const bar5Style = useAnimatedStyle(() => {
    "worklet";
    const mod = mode === "listening" ? getIntensity() * 0.9 : 1.0;
    return {
      transform: [{ scaleY: scale5.value * mod }],
    };
  });

  const resolvedColor =
    barColor ||
    (mode === "speaking"
      ? "#60A5FA" // Electric Blue for Speaking
      : "#00F2FE"); // Bright Neon Cyan for Listening

  return (
    <View style={[styles.container, { height }, style]}>
      <Animated.View style={[styles.bar, { backgroundColor: resolvedColor }, bar1Style]} />
      <Animated.View style={[styles.bar, { backgroundColor: resolvedColor }, bar2Style]} />
      <Animated.View style={[styles.bar, { backgroundColor: resolvedColor }, bar3Style]} />
      <Animated.View style={[styles.bar, { backgroundColor: resolvedColor }, bar4Style]} />
      <Animated.View style={[styles.bar, { backgroundColor: resolvedColor }, bar5Style]} />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4.5,
  },
  bar: {
    width: 4.5,
    height: 26,
    borderRadius: 2.5,
  },
});
