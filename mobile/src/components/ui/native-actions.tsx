import { Host, Button, Column } from "@expo/ui";
import { StyleSheet } from "react-native";
import { colors, spacing } from "@/theme";

type NativeActionsProps = {
  children: React.ReactNode;
};

/**
 * Wraps @expo/ui controls so they pick up our teal seedColor on both platforms
 * (SwiftUI tint on iOS, Material You tonal palette on Android).
 */
export function NativeHost({ children }: NativeActionsProps) {
  return (
    <Host matchContents seedColor={colors.seed} style={styles.host}>
      {children}
    </Host>
  );
}

type NativeButtonRowProps = {
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
  secondaryDisabled?: boolean;
};

/** Compact native button cluster for forms / tool rows. */
export function NativeButtonRow({
  primaryLabel,
  onPrimary,
  primaryDisabled,
  secondaryLabel,
  onSecondary,
  secondaryDisabled,
}: NativeButtonRowProps) {
  return (
    <NativeHost>
      <Column spacing={spacing.sm}>
        <Button
          label={primaryLabel}
          variant="filled"
          disabled={primaryDisabled}
          onPress={onPrimary}
        />
        {secondaryLabel && onSecondary ? (
          <Button
            label={secondaryLabel}
            variant="outlined"
            disabled={secondaryDisabled}
            onPress={onSecondary}
          />
        ) : null}
      </Column>
    </NativeHost>
  );
}

const styles = StyleSheet.create({
  host: {
    width: "100%",
  },
});
