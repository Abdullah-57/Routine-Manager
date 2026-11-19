import * as Haptics from "expo-haptics";
import React, { useEffect } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { AudioWaveformBars } from "./audio-waveform-bars";
import { DrawnCheckmark } from "./drawn-checkmark";
import { SparkleCluster } from "./sparkle-cluster";
import { colors, shadows } from "@/theme";

export type AssistantOrbPhase =
  | "idle"
  | "listening"
  | "thinking"
  | "responding"
  | "follow_up"
  | "done"
  | "error";

export type AssistantOrbProps = {
  /** Outer diameter of the central core orb in pixels (default: 58) */
  size?: number;
  /** Current operating phase of the assistant */
  phase?: AssistantOrbPhase;
  /** Whether the background or foreground microphone is currently listening */
  isListening?: boolean;
  /** Whether TTS speech synthesis is actively outputting audio */
  isTtsSpeaking?: boolean;
  /** Real-time microphone audio input volume (0..1) or Reanimated SharedValue */
  audioLevel?: number | SharedValue<number>;
  /** Whether to render fluid audio waveform bars inside the core during speech */
  showWaveform?: boolean;
  /** Whether to show the top-right mini status dot (e.g. for floating bubble) */
  showStatusDot?: boolean;
  /** Tap handler (fires haptics automatically) */
  onPress?: () => void;
  /** Custom container style */
  style?: StyleProp<ViewStyle>;
  /** Accessibility label */
  accessibilityLabel?: string;
  /** Accessibility hint */
  accessibilityHint?: string;
};

/**
 * Floating Glowing Assistant Orb (Feature 10.1)
 *
 * An organic, multi-layered Siri-like glowing orb with fluid acoustic pulsing,
 * GPU-accelerated rotation for thinking state, floating idle icons, and high-performance waveform bars.
 * Driven 100% on the GPU via Reanimated 4 worklets for silky 60-120fps motion.
 */
export const AssistantOrb = React.memo(function AssistantOrb({
  size = 58,
  phase = "idle",
  isListening = false,
  isTtsSpeaking = false,
  audioLevel,
  showWaveform = true,
  showStatusDot = false,
  onPress,
  style,
  accessibilityLabel = "Activate Routine Voice Assistant",
  accessibilityHint = "Activates hands-free speech assistant to schedule and manage routines",
}: AssistantOrbProps) {
  // Press spring scale
  const pressScale = useSharedValue(1);

  // Concentric ring shared values (GPU transforms and opacities)
  const ring1Scale = useSharedValue(1);
  const ring1Opacity = useSharedValue(0.3);

  const ring2Scale = useSharedValue(1);
  const ring2Opacity = useSharedValue(0.15);

  // Core breath scale
  const coreBreath = useSharedValue(1);

  // Thinking state dynamic rotation & pulse shared values
  const thinkingRotate = useSharedValue(0);
  const thinkingScale = useSharedValue(1);

  // Idle floating and done pop shared values
  const iconFloatY = useSharedValue(0);
  const iconScale = useSharedValue(1);
  const doneCheckScale = useSharedValue(0);
  const errorShakeX = useSharedValue(0);

  // Determine active visual state with strict mutual exclusivity
  // User Requirement: When Done stage is reached, retain emerald checkmark even during TTS closing speech
  const isDone = phase === "done";
  const isThinking = !isDone && phase === "thinking";
  const isSpeaking = !isDone && !isThinking && (phase === "responding" || isTtsSpeaking);
  const isError = !isDone && !isThinking && !isSpeaking && phase === "error";
  const isActuallyListening =
    !isDone &&
    !isThinking &&
    !isSpeaking &&
    !isError &&
    (phase === "listening" || phase === "follow_up" || isListening);

  // Dedicated UI-thread lifecycle for Thinking rotation and scale pulse
  useEffect(() => {
    if (isThinking) {
      // Continuous 360-degree rotation
      thinkingRotate.value = 0;
      thinkingRotate.value = withRepeat(
        withTiming(360, {
          duration: 1100,
          easing: Easing.linear,
        }),
        -1,
        false,
      );
      // Energetic scale pulse (reverses natively without withSequence)
      thinkingScale.value = 0.82;
      thinkingScale.value = withRepeat(
        withTiming(1.30, {
          duration: 450,
          easing: Easing.inOut(Easing.ease),
        }),
        -1,
        true,
      );
    } else {
      thinkingRotate.value = 0;
      thinkingScale.value = 1;
    }
  }, [isThinking, thinkingRotate, thinkingScale]);

  // Dedicated UI-thread lifecycle for Done checkmark and Error shake
  useEffect(() => {
    if (isDone) {
      // Celebratory entrance spring pop, followed by celebratory gentle pulsing
      doneCheckScale.value = 0.2;
      doneCheckScale.value = withSequence(
        withSpring(1.24, { damping: 9, stiffness: 200 }),
        withTiming(1.0, { duration: 180 }),
        withRepeat(
          withTiming(1.08, { duration: 550, easing: Easing.inOut(Easing.ease) }),
          -1,
          true,
        ),
      );
    } else {
      doneCheckScale.value = 0;
    }

    if (isError) {
      errorShakeX.value = withRepeat(
        withSequence(
          withTiming(-6, { duration: 60 }),
          withTiming(6, { duration: 120 }),
          withTiming(-4, { duration: 100 }),
          withTiming(0, { duration: 80 }),
        ),
        2,
        false,
      );
    } else {
      errorShakeX.value = 0;
    }
  }, [isDone, isError, doneCheckScale, errorShakeX]);

  // Dedicated UI-thread lifecycle for Idle floating icon
  useEffect(() => {
    if (!isThinking && !isSpeaking && !isActuallyListening && !isDone && !isError) {
      // Graceful, noticeable vertical floating bobbing (-6px to +6px)
      iconFloatY.value = -6;
      iconFloatY.value = withRepeat(
        withTiming(6, {
          duration: 750,
          easing: Easing.inOut(Easing.ease),
        }),
        -1,
        true,
      );
      // Subtle dynamic breathing scale
      iconScale.value = 0.92;
      iconScale.value = withRepeat(
        withTiming(1.08, {
          duration: 750,
          easing: Easing.inOut(Easing.ease),
        }),
        -1,
        true,
      );
    } else {
      iconFloatY.value = 0;
      iconScale.value = 1;
    }
  }, [isThinking, isSpeaking, isActuallyListening, isDone, isError, iconFloatY, iconScale]);

  // Main halo breathing & acoustic pulsing loop (GPU transforms)
  useEffect(() => {
    if (isDone) {
      // Celebratory emerald aura breathing
      ring1Scale.value = 1.0;
      ring1Scale.value = withRepeat(
        withTiming(1.26, { duration: 550, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
      ring1Opacity.value = 0.55;
      ring1Opacity.value = withRepeat(
        withTiming(0.15, { duration: 550, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );

      ring2Scale.value = 1.04;
      ring2Scale.value = withRepeat(
        withTiming(1.42, { duration: 750, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
      ring2Opacity.value = 0.32;
      ring2Opacity.value = withRepeat(
        withTiming(0.06, { duration: 750, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );

      coreBreath.value = 0.96;
      coreBreath.value = withRepeat(
        withTiming(1.05, { duration: 550, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    } else if (isThinking) {
      // Rapid amber gold thinking aura
      ring1Scale.value = 1.0;
      ring1Scale.value = withRepeat(
        withTiming(1.26, { duration: 380, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
      ring1Opacity.value = 0.6;
      ring1Opacity.value = withRepeat(
        withTiming(0.18, { duration: 380, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );

      ring2Scale.value = 1.04;
      ring2Scale.value = withRepeat(
        withTiming(1.44, { duration: 500, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
      ring2Opacity.value = 0.38;
      ring2Opacity.value = withRepeat(
        withTiming(0.08, { duration: 500, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );

      coreBreath.value = 0.95;
      coreBreath.value = withRepeat(
        withTiming(1.07, { duration: 380, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    } else if (isSpeaking) {
      // High-energy electric blue speech aura
      ring1Scale.value = 1.0;
      ring1Scale.value = withRepeat(
        withTiming(1.32, { duration: 280, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
      ring1Opacity.value = 0.55;
      ring1Opacity.value = withRepeat(
        withTiming(0.18, { duration: 280, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );

      ring2Scale.value = 1.06;
      ring2Scale.value = withRepeat(
        withTiming(1.50, { duration: 400, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
      ring2Opacity.value = 0.35;
      ring2Opacity.value = withRepeat(
        withTiming(0.08, { duration: 400, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );

      coreBreath.value = 0.96;
      coreBreath.value = withRepeat(
        withTiming(1.06, { duration: 280, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    } else if (isActuallyListening) {
      // Dynamic violet listening aura
      ring1Scale.value = 1.0;
      ring1Scale.value = withRepeat(
        withTiming(1.28, { duration: 600, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
      ring1Opacity.value = 0.55;
      ring1Opacity.value = withRepeat(
        withTiming(0.18, { duration: 600, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );

      ring2Scale.value = 1.04;
      ring2Scale.value = withRepeat(
        withTiming(1.46, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
      ring2Opacity.value = 0.34;
      ring2Opacity.value = withRepeat(
        withTiming(0.08, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );

      coreBreath.value = 0.96;
      coreBreath.value = withRepeat(
        withTiming(1.05, { duration: 600, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    } else {
      // Idle ambient breathing
      ring1Scale.value = 1.0;
      ring1Scale.value = withRepeat(
        withTiming(1.22, { duration: 900, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
      ring1Opacity.value = 0.42;
      ring1Opacity.value = withRepeat(
        withTiming(0.14, { duration: 900, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );

      ring2Scale.value = 1.04;
      ring2Scale.value = withRepeat(
        withTiming(1.38, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
      ring2Opacity.value = 0.26;
      ring2Opacity.value = withRepeat(
        withTiming(0.06, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );

      coreBreath.value = 0.97;
      coreBreath.value = withRepeat(
        withTiming(1.04, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    }
  }, [
    isDone,
    isActuallyListening,
    isSpeaking,
    isThinking,
    ring1Scale,
    ring1Opacity,
    ring2Scale,
    ring2Opacity,
    coreBreath,
  ]);

  // GPU animated styles
  const ring1Style = useAnimatedStyle(() => {
    "worklet";
    return {
      transform: [{ scale: ring1Scale.value }],
      opacity: ring1Opacity.value,
    };
  });

  const ring2Style = useAnimatedStyle(() => {
    "worklet";
    return {
      transform: [{ scale: ring2Scale.value }],
      opacity: ring2Opacity.value,
    };
  });

  const coreAnimStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      transform: [{ scale: pressScale.value * coreBreath.value }],
    };
  });

  const thinkingAnimStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      transform: [
        { rotate: `${thinkingRotate.value}deg` },
        { scale: thinkingScale.value },
      ],
    };
  });

  const dynamicIconAnimStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      transform: [
        { translateY: iconFloatY.value },
        { scale: iconScale.value },
        { translateX: errorShakeX.value },
      ],
    };
  });

  const doneCheckAnimStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      transform: [{ scale: doneCheckScale.value }],
    };
  });

  // Color palette selection with strict priority (isDone takes highest precedence)
  let haloColor = "#0284C7"; // Cyan / Blue default
  let coreBg = "#0284C7";
  let coreBorder = "rgba(255, 255, 255, 0.4)";

  if (isDone) {
    haloColor = "#10B981"; // Emerald
    coreBg = "#059669";
    coreBorder = "rgba(110, 231, 183, 0.7)";
  } else if (isThinking) {
    haloColor = "#F59E0B"; // Amber Gold
    coreBg = "#D97706";
    coreBorder = "rgba(252, 211, 77, 0.7)";
  } else if (isSpeaking) {
    haloColor = "#2563EB"; // Electric Blue
    coreBg = "#1D4ED8";
    coreBorder = "rgba(96, 165, 250, 0.6)";
  } else if (isActuallyListening) {
    haloColor = "#8B5CF6"; // Vibrant Violet/Magenta
    coreBg = "#7C3AED";
    coreBorder = "rgba(236, 72, 153, 0.6)";
  } else if (isError) {
    haloColor = "#EF4444"; // Rose / Red
    coreBg = "#DC2626";
    coreBorder = "rgba(252, 165, 165, 0.6)";
  }

  const ring1Size = size * 1.18;
  const ring2Size = size * 1.42;
  const containerBounds = size * 1.5;

  const handlePressIn = () => {
    pressScale.value = withSpring(0.92, { damping: 14, stiffness: 220 });
  };

  const handlePressOut = () => {
    pressScale.value = withSpring(1.0, { damping: 14, stiffness: 160 });
  };

  const handlePress = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onPress?.();
  };

  const content = (
    <View
      style={[
        styles.centerContainer,
        { width: containerBounds, height: containerBounds },
      ]}
    >
      {/* Outer Glow Ring (Ring 2) */}
      <Animated.View
        style={[
          styles.ring,
          {
            width: ring2Size,
            height: ring2Size,
            borderRadius: ring2Size / 2,
            backgroundColor: haloColor,
          },
          ring2Style,
        ]}
      />

      {/* Inner Aura Rim (Ring 1) */}
      <Animated.View
        style={[
          styles.ring,
          {
            width: ring1Size,
            height: ring1Size,
            borderRadius: ring1Size / 2,
            backgroundColor: haloColor,
            borderWidth: 1.5,
            borderColor: coreBorder,
          },
          ring1Style,
        ]}
      />

      {/* Core Orb Sphere */}
      <Animated.View
        style={[
          styles.core,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: coreBg,
            borderColor: coreBorder,
          },
          coreAnimStyle,
        ]}
      >
        {/* Dynamic Center Visual State — strictly ONE effect per state */}
        {isDone ? (
          /* Celebratory drawn checkmark specifically retained during Done stage (even during closing speech) */
          <DrawnCheckmark size={size} color="#FFFFFF" />
        ) : isThinking ? (
          /* Feature 10.1: Dedicated Thinking State — constellation of dynamic twinkling sparkles */
          <SparkleCluster size={size} />
        ) : (isActuallyListening || isSpeaking) && showWaveform ? (
          /* Active speech equalizer modulated by live voice intensity & speech level */
          <AudioWaveformBars
            isActive={true}
            mode={isSpeaking ? "speaking" : "listening"}
            audioLevel={audioLevel}
            height={size * 0.52}
          />
        ) : isError ? (
          /* Error shake alert */
          <Animated.View style={dynamicIconAnimStyle}>
            <Text style={[styles.iconText, { fontSize: size * 0.42 }]}>⚠️</Text>
          </Animated.View>
        ) : (
          /* Idle floating icon with dynamic breathing */
          <Animated.View style={dynamicIconAnimStyle}>
            <Text style={[styles.iconText, { fontSize: size * 0.44 }]}>
              {isActuallyListening ? "✨" : "🎙️"}
            </Text>
          </Animated.View>
        )}
      </Animated.View>

      {/* Optional Top-Right Status Dot (Active listening indicator) */}
      {showStatusDot && (
        <View
          style={[
            styles.statusDot,
            {
              top: (containerBounds - size) / 2 + 1,
              right: (containerBounds - size) / 2 + 1,
            },
            isListening ? styles.statusDotActive : styles.statusDotStandby,
          ]}
        />
      )}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
        style={[styles.pressableWrapper, style]}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        hitSlop={10}
      >
        {content}
      </Pressable>
    );
  }

  return <View style={[styles.pressableWrapper, style]}>{content}</View>;
});

const styles = StyleSheet.create({
  pressableWrapper: {
    alignItems: "center",
    justifyContent: "center",
  },
  centerContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  ring: {
    position: "absolute",
  },
  core: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    overflow: "hidden",
    boxShadow: shadows.raised,
    elevation: 8,
  },
  thinkingIconWrapper: {
    alignItems: "center",
    justifyContent: "center",
  },
  thinkingSparkle: {
    textAlign: "center",
  },
  iconText: {
    color: "#FFFFFF",
    fontWeight: "700",
    textAlign: "center",
  },
  statusDot: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    zIndex: 10,
  },
  statusDotActive: {
    backgroundColor: "#10B981",
  },
  statusDotStandby: {
    backgroundColor: "#94A3B8",
  },
});
