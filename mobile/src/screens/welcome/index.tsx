import * as Haptics from "expo-haptics";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Image,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  Easing,
  Extrapolation,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, motion, radius, spacing } from "@/theme";

/** Short pull or a light flick is enough — easier than a long deliberate swipe. */
const SWIPE_THRESHOLD = 48;
const VELOCITY_THRESHOLD = -0.35;

/**
 * First-open welcome — logo + name + swipe-up to reach the existing login route.
 *
 * Uses React Native Image + PanResponder (already in your current native build).
 * Avoids expo-image / gesture-handler, which need a new APK after install.
 */
export function WelcomeScreen() {
  const { push } = useRouter();
  const insets = useSafeAreaInsets();
  const dragY = useSharedValue(0);
  const hintY = useSharedValue(0);
  const navigatedRef = useRef(false);

  const resetSwipeUi = useCallback(() => {
    // Snap layout back to resting place and allow swipe → login again.
    cancelAnimation(dragY);
    dragY.set(0);
    navigatedRef.current = false;
  }, [dragY]);

  // Welcome stays mounted under the auth stack, so leaving for login would
  // otherwise leave dragY / navigatedRef stuck until a full remount.
  useFocusEffect(
    useCallback(() => {
      resetSwipeUi();
      return () => {
        resetSwipeUi();
      };
    }, [resetSwipeUi]),
  );

  useEffect(() => {
    hintY.set(
      withRepeat(
        withTiming(-10, {
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
        }),
        -1,
        true,
      ),
    );
    return () => {
      cancelAnimation(hintY);
    };
  }, [hintY]);

  const goToLogin = useCallback(() => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;

    if (process.env.EXPO_OS === "ios") {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
        () => undefined,
      );
    }

    dragY.set(
      withTiming(-220, {
        duration: motion.enterMs,
        easing: motion.easeOut,
      }),
    );
    push("/(auth)/login");
  }, [dragY, push]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Claim the gesture early so small upward flicks aren’t lost to scroll/parents.
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_evt, gesture) =>
          Math.abs(gesture.dy) > 2 &&
          Math.abs(gesture.dy) >= Math.abs(gesture.dx) * 0.6,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_evt, gesture) => {
          if (navigatedRef.current) return;
          // Only follow upward swipes (negative dy).
          dragY.set(Math.min(0, gesture.dy));
        },
        onPanResponderRelease: (_evt, gesture) => {
          if (navigatedRef.current) return;

          const pulledFarEnough = gesture.dy < -SWIPE_THRESHOLD;
          const flickedUp = gesture.vy < VELOCITY_THRESHOLD;
          // Mid-pull + any upward release still counts — smoother “almost there” success.
          const softCommit =
            gesture.dy < -(SWIPE_THRESHOLD * 0.55) && gesture.vy <= 0;

          if (pulledFarEnough || flickedUp || softCommit) {
            goToLogin();
            return;
          }

          dragY.set(
            withSpring(0, {
              duration: 320,
              dampingRatio: 0.86,
            }),
          );
        },
        onPanResponderTerminate: () => {
          if (navigatedRef.current) return;
          dragY.set(
            withSpring(0, {
              duration: 320,
              dampingRatio: 0.86,
            }),
          );
        },
      }),
    [dragY, goToLogin],
  );

  const contentStyle = useAnimatedStyle(() => ({
    transform: [
      {
        // Closer to 1:1 finger tracking so the swipe feels responsive.
        translateY: interpolate(
          dragY.get(),
          [-220, 0],
          [-120, 0],
          Extrapolation.CLAMP,
        ),
      },
      {
        scale: interpolate(
          dragY.get(),
          [-220, 0],
          [0.985, 1],
          Extrapolation.CLAMP,
        ),
      },
    ],
    opacity: interpolate(
      dragY.get(),
      [-220, 0],
      [0.9, 1],
      Extrapolation.CLAMP,
    ),
  }));

  const hintStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: hintY.get() + dragY.get() * 0.15 }],
    opacity: interpolate(
      dragY.get(),
      [-SWIPE_THRESHOLD, 0],
      [0.35, 1],
      Extrapolation.CLAMP,
    ),
  }));

  return (
    <View style={styles.root} {...panResponder.panHandlers}>
      <View style={styles.gradient} pointerEvents="none" />

      <Animated.View
        style={[
          styles.content,
          {
            paddingTop: insets.top + spacing.xl,
            paddingBottom: insets.bottom + spacing.lg,
          },
          contentStyle,
        ]}
      >
        <View style={styles.brandBlock}>
          <View style={styles.logoRing}>
            <Image
              source={require("../../../assets/images/icon.png")}
              style={styles.logo}
              resizeMode="cover"
              accessibilityLabel="Routine Manager logo"
            />
          </View>
          <Text style={styles.appName}>Routine Manager</Text>
          <Text style={styles.tagline}>Plan your day in plain language.</Text>
        </View>

        <Animated.View style={[styles.swipeHint, hintStyle]}>
          <View style={styles.grabber} />
          <Text style={styles.swipeLabel}>Swipe up to log in</Text>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    // Fallback if CSS gradient isn’t painted yet — logo-matched blue.
    backgroundColor: "#3B82F6",
  },
  gradient: {
    ...StyleSheet.absoluteFill,
    // Matches the logo: cornflower → sky blue, with deeper navy at the bottom for contrast.
    experimental_backgroundImage: `
      radial-gradient(circle at 18% 12%, rgba(168, 216, 255, 0.55) 0%, transparent 40%),
      radial-gradient(circle at 88% 22%, rgba(96, 165, 250, 0.40) 0%, transparent 46%),
      linear-gradient(165deg, #93C5FD 0%, #60A5FA 28%, #3B82F6 58%, #1D4ED8 82%, #1E3A8A 100%)
    `,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    justifyContent: "space-between",
  },
  brandBlock: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  logoRing: {
    width: 112,
    height: 112,
    borderRadius: radius.xl + 4,
    borderCurve: "continuous",
    overflow: "hidden",
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.28)",
  },
  logo: {
    width: "100%",
    height: "100%",
  },
  appName: {
    fontSize: 32,
    fontWeight: "700",
    letterSpacing: -0.6,
    color: colors.onTint,
    textAlign: "center",
  },
  tagline: {
    fontSize: 16,
    lineHeight: 22,
    color: "rgba(255, 255, 255, 0.78)",
    textAlign: "center",
    maxWidth: 280,
  },
  swipeHint: {
    alignItems: "center",
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  grabber: {
    width: 44,
    height: 5,
    borderRadius: radius.full,
    backgroundColor: "rgba(255, 255, 255, 0.55)",
  },
  swipeLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: "rgba(255, 255, 255, 0.88)",
    letterSpacing: 0.2,
  },
});
