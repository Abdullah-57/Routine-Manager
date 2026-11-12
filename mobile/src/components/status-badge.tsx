import {
  StyleSheet,
  Text,
  View,
  type ColorValue,
} from "react-native";
import { radius, spacing } from "@/theme";

const STATUS_STYLES: Record<
  string,
  { backgroundColor: ColorValue; color: ColorValue }
> = {
  scheduled: {
    backgroundColor: "rgba(37, 99, 235, 0.12)",
    color: "#1D4ED8",
  },
  completed: {
    backgroundColor: "rgba(5, 150, 105, 0.12)",
    color: "#059669",
  },
  cancelled: {
    backgroundColor: "#F3F4F6",
    color: "#64748B",
  },
};

const FALLBACK: { backgroundColor: ColorValue; color: ColorValue } = {
  backgroundColor: "#F3F4F6",
  color: "#64748B",
};

export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_STYLES[status] ?? FALLBACK;
  const label = status || "scheduled";

  return (
    <View style={[styles.badge, { backgroundColor: tone.backgroundColor }]}>
      <Text style={[styles.label, { color: tone.color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    alignSelf: "flex-start",
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "capitalize",
  },
});
