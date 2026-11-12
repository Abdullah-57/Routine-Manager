import { StyleSheet } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { ThemedText } from "@/components/ui/themed-text";
import { colors, motion, radius, spacing } from "@/theme";

type Tone = "success" | "error" | "info";

type FeedbackBannerProps = {
  tone: Tone;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
};

/**
 * Occasional state banner — fade in/out only (no staggered “grand entrance”).
 */
export function FeedbackBanner({
  tone,
  title,
  body,
  actionLabel,
  onAction,
}: FeedbackBannerProps) {
  return (
    <Animated.View
      entering={FadeIn.duration(motion.enterMs).easing(motion.easeOut)}
      exiting={FadeOut.duration(120)}
      style={[styles.base, toneStyles[tone]]}
    >
      <ThemedText variant="headline" style={titleStyles[tone]}>
        {title}
      </ThemedText>
      <ThemedText variant="subhead" style={styles.body}>
        {body}
      </ThemedText>
      {actionLabel && onAction ? (
        <ThemedText
          variant="headline"
          style={styles.action}
          onPress={onAction}
          accessibilityRole="button"
        >
          {actionLabel}
        </ThemedText>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    borderCurve: "continuous",
    padding: spacing.md - 2,
    gap: spacing.xs,
  },
  body: {
    color: colors.label,
  },
  action: {
    marginTop: spacing.xs,
    color: colors.tint,
  },
});

const toneStyles = StyleSheet.create({
  success: {
    backgroundColor: "rgba(5, 150, 105, 0.10)",
  },
  error: {
    backgroundColor: "rgba(220, 38, 38, 0.10)",
  },
  info: {
    backgroundColor: "rgba(15, 118, 110, 0.10)",
  },
});

const titleStyles = StyleSheet.create({
  success: { color: colors.success },
  error: { color: colors.danger },
  info: { color: colors.tint },
});
