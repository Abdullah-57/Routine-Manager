import { StyleSheet, Text, View } from "react-native";

const STATUS_STYLES: Record<
  string,
  { backgroundColor: string; color: string; borderColor: string }
> = {
  scheduled: {
    backgroundColor: "#eff6ff",
    color: "#1d4ed8",
    borderColor: "#bfdbfe",
  },
  completed: {
    backgroundColor: "#ecfdf5",
    color: "#047857",
    borderColor: "#a7f3d0",
  },
  cancelled: {
    backgroundColor: "#f5f5f5",
    color: "#525252",
    borderColor: "#d4d4d4",
  },
};

const FALLBACK = {
  backgroundColor: "#f5f5f5",
  color: "#525252",
  borderColor: "#d4d4d4",
};

export function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_STYLES[status] ?? FALLBACK;
  const label = status || "scheduled";

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: tone.backgroundColor,
          borderColor: tone.borderColor,
        },
      ]}
    >
      <Text style={[styles.label, { color: tone.color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: "flex-start",
  },
  label: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "capitalize",
  },
});
