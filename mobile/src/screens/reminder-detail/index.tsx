import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ApiError } from "@/api/client";
import { getReminder, type ReminderSummary } from "@/api/reminders";
import { useAuth } from "@/auth/AuthContext";
import { formatReminderTime } from "@/utils/reminder-time";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; reminder: ReminderSummary }
  | { status: "error"; message: string };

function getDeviceTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function ReminderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, user } = useAuth();
  const { back } = useRouter();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const timezone = user?.timezone || getDeviceTimezone();

  const load = useCallback(async () => {
    if (!token || !id) {
      setState({ status: "error", message: "Missing reminder id or session." });
      return;
    }

    setState({ status: "loading" });
    try {
      const { reminder } = await getReminder(token, id);
      setState({ status: "ready", reminder });
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Could not load this reminder.";
      setState({ status: "error", message });
    }
  }, [token, id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
    >
      {state.status === "loading" ? (
        <ActivityIndicator color="#2563eb" />
      ) : null}

      {state.status === "error" ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorLabel}>Error</Text>
          <Text style={styles.errorBody}>{state.message}</Text>
          <Pressable accessibilityRole="button" onPress={() => void load()}>
            <Text style={styles.retry}>Retry</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => back()}>
            <Text style={styles.retry}>Go back</Text>
          </Pressable>
        </View>
      ) : null}

      {state.status === "ready" ? (
        <View style={styles.section}>
          <Text style={styles.title}>{state.reminder.title}</Text>
          <Text style={styles.meta}>Status: {state.reminder.status}</Text>
          <Text style={styles.meta}>Source: {state.reminder.source}</Text>
          <Text style={styles.label}>Starts</Text>
          <Text style={styles.value}>
            {formatReminderTime(
              state.reminder.startAt,
              state.reminder.timezone || timezone,
            )}
          </Text>
          {state.reminder.endAt ? (
            <>
              <Text style={styles.label}>Ends</Text>
              <Text style={styles.value}>
                {formatReminderTime(
                  state.reminder.endAt,
                  state.reminder.timezone || timezone,
                )}
              </Text>
            </>
          ) : null}
          <Text style={styles.label}>Notes</Text>
          <Text style={styles.value}>
            {state.reminder.notes || "No notes"}
          </Text>
          <Text style={styles.hint}>
            Edit and delete arrive in the next feature (4.2).
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    gap: 16,
  },
  section: {
    gap: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
  },
  meta: {
    color: "#737373",
    fontSize: 14,
  },
  label: {
    marginTop: 8,
    fontSize: 13,
    fontWeight: "600",
    color: "#525252",
  },
  value: {
    fontSize: 16,
    color: "#171717",
    lineHeight: 22,
  },
  hint: {
    marginTop: 16,
    color: "#737373",
    lineHeight: 20,
  },
  errorBox: {
    backgroundColor: "#fef2f2",
    borderRadius: 12,
    borderCurve: "continuous",
    padding: 14,
    gap: 8,
  },
  errorLabel: {
    fontWeight: "700",
  },
  errorBody: {
    color: "#404040",
  },
  retry: {
    color: "#2563eb",
    fontWeight: "600",
  },
});
