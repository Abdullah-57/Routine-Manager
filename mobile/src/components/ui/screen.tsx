import {
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { colors, spacing } from "@/theme";

type ScreenScrollProps = {
  children: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
};

/** Standard scrollable screen shell with safe-area inset adjustment. */
export function ScreenScroll({ children, contentStyle }: ScreenScrollProps) {
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={styles.scroll}
      contentContainerStyle={[styles.content, contentStyle]}
    >
      {children}
    </ScrollView>
  );
}

type ScreenSectionProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function ScreenSection({ children, style }: ScreenSectionProps) {
  return <View style={[styles.section, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.groupedBackground,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  section: {
    gap: spacing.sm,
  },
});
