import * as Haptics from "expo-haptics";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { colors, motion, radius, spacing } from "@/theme";

type Variant = "primary" | "secondary" | "danger" | "ghost";

type AppButtonProps = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

/**
 * Shared button with light press scale (transform + opacity only).
 * Uses Pressable (not Touchable*) so feedback stays intentional.
 */
export function AppButton({
  label,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false,
  style,
  accessibilityLabel,
}: AppButtonProps) {
  const isDisabled = disabled || loading;
  const spinnerColor = variant === "primary" ? colors.onTint : colors.tint;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={isDisabled}
      onPress={() => {
        if (process.env.EXPO_OS === "ios") {
          void Haptics.selectionAsync();
        }
        onPress();
      }}
      style={({ pressed }) => [
        styles.base,
        variantStyles[variant],
        pressed && !isDisabled ? styles.pressed : null,
        isDisabled ? styles.disabled : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={spinnerColor} />
      ) : (
        <Text style={[styles.label, labelStyles[variant]]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderCurve: "continuous",
  },
  pressed: {
    opacity: 0.92,
    transform: [{ scale: motion.pressScale }],
  },
  disabled: {
    opacity: 0.55,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
  },
});

const variantStyles = StyleSheet.create({
  primary: {
    backgroundColor: colors.tint,
  },
  secondary: {
    backgroundColor: "transparent",
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: colors.tint,
  },
  danger: {
    backgroundColor: "transparent",
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: colors.danger,
  },
  ghost: {
    backgroundColor: colors.fill,
  },
});

const labelStyles = StyleSheet.create({
  primary: { color: colors.onTint },
  secondary: { color: colors.tint },
  danger: { color: colors.danger },
  ghost: { color: colors.label },
});
