import * as Haptics from "expo-haptics";
import React, { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, shadows } from "@/theme";

export type FloatingAssistantBubbleProps = {
  visible?: boolean;
  isListening: boolean;
  onPress: () => void;
};

/**
 * Floating Assistant Mic Bubble (Feature 1.4)
 * Provides ambient wake-state feedback on the Home screen and an instant 1-tap manual
 * trigger to activate the assistant without needing to speak the wake word aloud.
 */
export function FloatingAssistantBubble({
  visible = true,
  isListening,
  onPress,
}: FloatingAssistantBubbleProps) {
  const insets = useSafeAreaInsets();
  const scale = useSharedValue(visible ? 1 : 0);
  const opacity = useSharedValue(visible ? 1 : 0);
  const pulseScale = useSharedValue(1);
  const pulseOpacity = useSharedValue(0.3);

  // Smooth appearance/exit when overlay or modals open/close
  useEffect(() => {
    if (visible) {
      scale.value = withSpring(1, { damping: 14, stiffness: 140 });
      opacity.value = withTiming(1, { duration: 180 });
    } else {
      scale.value = withTiming(0, { duration: 150 });
      opacity.value = withTiming(0, { duration: 150 });
    }
  }, [visible, opacity, scale]);

  // Ambient breathing pulse when background microphone is listening for wake phrase
  useEffect(() => {
    if (isListening && visible) {
      pulseScale.value = withRepeat(
        withSequence(
          withTiming(1.35, {
            duration: 1200,
            easing: Easing.inOut(Easing.ease),
          }),
          withTiming(1.0, {
            duration: 1200,
            easing: Easing.inOut(Easing.ease),
          }),
        ),
        -1,
        true,
      );
      pulseOpacity.value = withRepeat(
        withSequence(
          withTiming(0.45, { duration: 1200 }),
          withTiming(0.1, { duration: 1200 }),
        ),
        -1,
        true,
      );
    } else {
      pulseScale.value = withTiming(1, { duration: 250 });
      pulseOpacity.value = withTiming(0, { duration: 250 });
    }
  }, [isListening, visible, pulseOpacity, pulseScale]);

  const animatedContainerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const animatedPulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
    opacity: pulseOpacity.value,
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.9, { damping: 12, stiffness: 200 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 14, stiffness: 140 });
  };

  const handlePress = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(
      () => {},
    );
    onPress();
  };

  const bottomPosition = Math.max(insets.bottom, 16) + 14;

  return (
    <Animated.View
      pointerEvents={visible ? "auto" : "none"}
      style={[
        styles.container,
        { bottom: bottomPosition },
        animatedContainerStyle,
      ]}
    >
      {/* Ambient Pulsing Ring */}
      <Animated.View
        style={[
          styles.pulseRing,
          isListening ? styles.pulseRingListening : null,
          animatedPulseStyle,
        ]}
      />

      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={handlePress}
        style={styles.bubble}
        accessibilityRole="button"
        accessibilityLabel="Activate Voice Assistant"
        accessibilityHint="Opens hands-free voice assistant to schedule or manage routines"
        hitSlop={12}
      >
        <Text style={styles.icon}>🎙️</Text>

        {/* Live background listening indicator badge */}
        <View
          style={[
            styles.badgeDot,
            isListening ? styles.badgeDotActive : styles.badgeDotStandby,
          ]}
        />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    right: 20,
    width: 60,
    height: 60,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 99,
  },
  pulseRing: {
    position: "absolute",
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.tint,
  },
  pulseRingListening: {
    backgroundColor: "#10B981",
  },
  bubble: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.tint,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: shadows.raised,
    elevation: 8,
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.4)",
  },
  icon: {
    fontSize: 24,
  },
  badgeDot: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  badgeDotActive: {
    backgroundColor: "#10B981",
  },
  badgeDotStandby: {
    backgroundColor: "#94A3B8",
  },
});
