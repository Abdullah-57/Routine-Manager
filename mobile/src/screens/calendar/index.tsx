import { ScrollView, StyleSheet, Text, View } from "react-native";

export function CalendarScreen() {
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
    >
      <View style={styles.section}>
        <Text style={styles.title}>Calendar</Text>
        <Text style={styles.subtitle}>
          Custom in-app calendar placeholder. Reminders will appear here in a
          later feature.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    gap: 12,
  },
  section: {
    gap: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 22,
    color: "#525252",
  },
});
