import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

export type DrawnCheckmarkProps = {
  /** Outer diameter of parent orb core */
  size: number;
  /** Color of checkmark stroke (default: white) */
  color?: string;
};

/**
 * Animated Drawn Checkmark (Feature 10.1)
 *
 * A bold, high-contrast checkmark that animates being drawn stroke-by-stroke:
 * 1. Short stroke draws downwards from top-left into the vertex.
 * 2. Vertex cap seamlessly unifies the elbow joint.
 * 3. Long stroke shoots upwards from vertex to top-right.
 * 4. Followed by a celebratory spring bounce pop.
 *
 * Sized to fill ~65% of the orb core with a bold 6.5px stroke so it is
 * prominently visible and mathematically joined at the vertex.
 */
export function DrawnCheckmark({ size, color = "#FFFFFF" }: DrawnCheckmarkProps) {
  const stroke1Progress = useSharedValue(0);
  const stroke2Progress = useSharedValue(0);
  const containerScale = useSharedValue(0.85);

  const containerSize = size * 0.65;
  const strokeWidth = Math.max(6, size * 0.085);
  const borderRadius = strokeWidth / 2;

  // Proportional stroke lengths
  const shortLen = containerSize * 0.40;
  const longLen = containerSize * 0.78;

  // Angles in radians
  const angle1Rad = (45 * Math.PI) / 180;
  const angle2Rad = (48 * Math.PI) / 180;

  // Perfectly centered vertex coordinates
  const vertexX = containerSize * 0.38;
  const vertexY = containerSize * 0.75;

  // Stroke 1 starts at top-left so its tip lands exactly at (vertexX, vertexY)
  const stroke1Left = vertexX - shortLen * Math.cos(angle1Rad);
  const stroke1Top = vertexY - shortLen * Math.sin(angle1Rad) - strokeWidth / 2;

  // Stroke 2 starts exactly at (vertexX, vertexY) and shoots up-right
  const stroke2Left = vertexX;
  const stroke2Top = vertexY - strokeWidth / 2;

  useEffect(() => {
    // Reset shared values
    stroke1Progress.value = 0;
    stroke2Progress.value = 0;
    containerScale.value = 0.85;

    // Stroke 1: Draw down-right into vertex (130ms)
    stroke1Progress.value = withTiming(1, {
      duration: 130,
      easing: Easing.out(Easing.cubic),
    });

    // Stroke 2: Draw up-right out of vertex immediately as Stroke 1 arrives (200ms)
    stroke2Progress.value = withDelay(
      120,
      withTiming(1, {
        duration: 200,
        easing: Easing.out(Easing.cubic),
      }),
    );

    // Celebratory bounce pop as Stroke 2 completes
    containerScale.value = withDelay(
      260,
      withSequence(
        withSpring(1.15, { damping: 8, stiffness: 220 }),
        withSpring(1.0, { damping: 12, stiffness: 160 }),
      ),
    );
  }, [containerScale, stroke1Progress, stroke2Progress]);

  const stroke1Style = useAnimatedStyle(() => {
    "worklet";
    return {
      transform: [
        { rotate: "45deg" },
        { scaleX: stroke1Progress.value },
      ],
      opacity: stroke1Progress.value > 0.02 ? 1 : 0,
    };
  });

  const vertexCapStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      opacity: stroke1Progress.value > 0.5 ? 1 : 0,
      transform: [{ scale: stroke1Progress.value > 0.5 ? 1 : 0 }],
    };
  });

  const stroke2Style = useAnimatedStyle(() => {
    "worklet";
    return {
      transform: [
        { rotate: "-48deg" },
        { scaleX: stroke2Progress.value },
      ],
      opacity: stroke2Progress.value > 0.02 ? 1 : 0,
    };
  });

  const containerAnimStyle = useAnimatedStyle(() => {
    "worklet";
    return {
      transform: [{ scale: containerScale.value }],
    };
  });

  return (
    <Animated.View
      style={[
        styles.container,
        { width: containerSize, height: containerSize },
        containerAnimStyle,
      ]}
    >
      {/* Short Downward Stroke (top-left down to vertex) */}
      <Animated.View
        style={[
          styles.stroke,
          {
            width: shortLen,
            height: strokeWidth,
            borderRadius,
            backgroundColor: color,
            left: stroke1Left,
            top: stroke1Top,
            transformOrigin: "0% 50%",
          },
          stroke1Style,
        ]}
      />

      {/* Seamless Vertex Joint Cap: unifies the elbow of the two lines */}
      <Animated.View
        style={[
          styles.vertexCap,
          {
            width: strokeWidth,
            height: strokeWidth,
            borderRadius: strokeWidth / 2,
            backgroundColor: color,
            left: vertexX - strokeWidth / 2,
            top: vertexY - strokeWidth / 2,
          },
          vertexCapStyle,
        ]}
      />

      {/* Long Upward Stroke (vertex up-right to top-right) */}
      <Animated.View
        style={[
          styles.stroke,
          {
            width: longLen,
            height: strokeWidth,
            borderRadius,
            backgroundColor: color,
            left: stroke2Left,
            top: stroke2Top,
            transformOrigin: "0% 50%",
          },
          stroke2Style,
        ]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "relative",
  },
  stroke: {
    position: "absolute",
  },
  vertexCap: {
    position: "absolute",
    zIndex: 2,
  },
});
