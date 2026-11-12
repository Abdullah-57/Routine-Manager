import {
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { radius, shadows, spacing } from "@/theme";

type AuthShellProps = {
  children: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
};

/**
 * Shared welcome-style chrome for auth screens:
 * logo-blue gradient + centered scrollable content.
 */
export function AuthShell({ children, contentStyle }: AuthShellProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <View style={styles.gradient} pointerEvents="none" />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: spacing.lg,
            paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.md,
          },
          contentStyle,
        ]}
      >
        {children}
      </ScrollView>
    </View>
  );
}

type AuthCardProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

/** Frosted white card so fields/labels pop on the blue gradient. */
export function AuthCard({ children, style }: AuthCardProps) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#3B82F6",
  },
  gradient: {
    ...StyleSheet.absoluteFill,
    experimental_backgroundImage: `
      radial-gradient(circle at 18% 12%, rgba(168, 216, 255, 0.55) 0%, transparent 40%),
      radial-gradient(circle at 88% 22%, rgba(96, 165, 250, 0.40) 0%, transparent 46%),
      linear-gradient(165deg, #93C5FD 0%, #60A5FA 28%, #3B82F6 58%, #1D4ED8 82%, #1E3A8A 100%)
    `,
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    gap: spacing.sm + 2,
    padding: spacing.lg - 4,
    borderRadius: radius.xl,
    borderCurve: "continuous",
    backgroundColor: "rgba(255, 255, 255, 0.94)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.7)",
    boxShadow: shadows.raised,
  },
});
