import { Platform } from "react-native";
import { Color } from "expo-router";

/**
 * Quiet Ink — modern minimal palette.
 * Semantic colors adapt to light/dark; brand accent is a calm teal (not purple).
 */
export const colors = {
  label: Platform.select({
    ios: Color.ios.label,
    android: Color.android.dynamic.onSurface,
    default: "#111827",
  })!,
  secondaryLabel: Platform.select({
    ios: Color.ios.secondaryLabel,
    android: Color.android.dynamic.onSurfaceVariant,
    default: "#6B7280",
  })!,
  tertiaryLabel: Platform.select({
    ios: Color.ios.tertiaryLabel,
    android: Color.android.dynamic.onSurfaceVariant,
    default: "#9CA3AF",
  })!,
  separator: Platform.select({
    ios: Color.ios.separator,
    android: Color.android.dynamic.outlineVariant,
    default: "#E5E7EB",
  })!,
  systemBackground: Platform.select({
    ios: Color.ios.systemBackground,
    android: Color.android.dynamic.surface,
    default: "#FFFFFF",
  })!,
  groupedBackground: Platform.select({
    ios: Color.ios.systemGroupedBackground,
    android: Color.android.dynamic.background,
    default: "#F3F4F6",
  })!,
  secondaryGroupedBackground: Platform.select({
    ios: Color.ios.secondarySystemGroupedBackground,
    android: Color.android.dynamic.surfaceContainer,
    default: "#FFFFFF",
  })!,
  fill: Platform.select({
    ios: Color.ios.secondarySystemFill,
    android: Color.android.dynamic.surfaceContainerHighest,
    default: "#F3F4F6",
  })!,
  /** Brand tint — also Host seedColor so @expo/ui controls match. */
  tint: Platform.select({
    ios: "#0F766E",
    android: Color.android.dynamic.primary,
    default: "#0F766E",
  })!,
  onTint: "#FFFFFF",
  danger: Platform.select({
    ios: Color.ios.systemRed,
    android: Color.android.dynamic.error,
    default: "#DC2626",
  })!,
  success: Platform.select({
    ios: Color.ios.systemGreen,
    android: "#059669",
    default: "#059669",
  })!,
  warning: Platform.select({
    ios: Color.ios.systemOrange,
    android: "#D97706",
    default: "#D97706",
  })!,
  /** Fixed brand seed for Host (Material You / SwiftUI tint). */
  seed: "#0F766E",
} as const;
