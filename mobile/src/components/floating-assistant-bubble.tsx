import React, { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AssistantOrb } from "./assistant-orb";

export type FloatingAssistantBubbleProps = {
  visible?: boolean;
  isListening: boolean;
  onPress: () => void;
};

/**
 * Floating Assistant Mic Bubble (Feature 1.4 & Feature 10.1)
 *
 * Provides ambient wake-state feedback on the Home screen using the multi-ring glowing AssistantOrb.
 * Offers an instant 1-tap manual trigger to activate the assistant without speaking the wake word aloud.
 */
export function FloatingAssistantBubble({
  visible = true,
  isListening,
  onPress,
}: FloatingAssistantBubbleProps) {
  const insets = useSafeAreaInsets();
  const scale = useSharedValue(visible ? 1 : 0);
  const opacity = useSharedValue(visible ? 1 : 0);

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

  const animatedContainerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  if (!visible) return null;

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
      <AssistantOrb
        size={56}
        phase={isListening ? "listening" : "idle"}
        isListening={isListening}
        showStatusDot={true}
        showWaveform={false}
        onPress={onPress}
        accessibilityLabel="Activate Voice Assistant"
        accessibilityHint="Opens hands-free voice assistant to schedule or manage routines"
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    right: 18,
    zIndex: 99,
    alignItems: "center",
    justifyContent: "center",
  },
});
