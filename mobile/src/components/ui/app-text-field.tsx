import {
  StyleSheet,
  TextInput,
  type TextInputProps,
  type StyleProp,
  type TextStyle,
} from "react-native";
import { colors, radius, spacing, type } from "@/theme";

type AppTextFieldProps = TextInputProps & {
  style?: StyleProp<TextStyle>;
};

/** Themed text field — same controlled API as RN TextInput (no logic change). */
export function AppTextField({ style, ...props }: AppTextFieldProps) {
  return (
    <TextInput
      placeholderTextColor={colors.tertiaryLabel}
      selectionColor={colors.tint}
      {...props}
      style={[styles.input, style]}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    ...type.body,
    color: colors.label,
    backgroundColor: colors.secondaryGroupedBackground,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    borderRadius: radius.md,
    borderCurve: "continuous",
    paddingHorizontal: spacing.md - 2,
    paddingVertical: 12,
  },
});
