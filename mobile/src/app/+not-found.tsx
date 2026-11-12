import { Link, Stack } from "expo-router";
import { StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/ui/themed-text";
import { colors, spacing } from "@/theme";

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Not found" }} />
      <View style={styles.container}>
        <ThemedText variant="title">This screen does not exist.</ThemedText>
        <Link href="/" style={styles.link}>
          <ThemedText variant="headline" style={styles.linkText}>
            Go to Home
          </ThemedText>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.md,
    gap: spacing.sm + 4,
    backgroundColor: colors.groupedBackground,
  },
  link: {
    marginTop: spacing.sm,
  },
  linkText: {
    color: colors.tint,
  },
});
