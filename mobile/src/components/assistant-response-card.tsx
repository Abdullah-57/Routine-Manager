import { StyleSheet, Text, View } from "react-native";
import { radius, spacing } from "@/theme";

type AssistantResponseCardProps = {
  message: string;
};

/**
 * Formats the AI assistant blob into readable paragraphs (no logic change).
 */
export function AssistantResponseCard({ message }: AssistantResponseCardProps) {
  const paragraphs = message
    .split(/\n{2,}|\n/)
    .map((part) => part.trim())
    .filter(Boolean);

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>AI response</Text>
      {paragraphs.map((line, index) => (
        <Text key={`${index}-${line.slice(0, 12)}`} style={styles.body}>
          {line}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderCurve: "continuous",
    backgroundColor: "rgba(37, 99, 235, 0.08)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(37, 99, 235, 0.22)",
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
    color: "#1D4ED8",
    textTransform: "uppercase",
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: "#1E293B",
  },
});
