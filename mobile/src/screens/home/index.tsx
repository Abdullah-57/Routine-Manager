import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ApiError, pingHealth } from "@/api/client";
import {
  listReminders,
  parseRoutine,
  parseRoutineAudio,
  type ReminderSummary,
} from "@/api/routines";
import { useAuth } from "@/auth/AuthContext";
import { StatusBadge } from "@/components/status-badge";
import { VoicePlanButton } from "@/components/voice-plan-button";
import {
  requestNotificationPermission,
  scheduleReminderLocalNotification,
  syncLocalNotificationsForReminders,
} from "@/notifications/local-reminders";

type PingState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

type PlanState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

const RECENT_PREVIEW_COUNT = 5;

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatReminderTime(iso: string, timezone: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return timeFormatter.format(new Date(iso));
  }
}

function getDeviceTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function sortNewestFirst(items: ReminderSummary[]) {
  return [...items].sort((a, b) => {
    const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (bCreated !== aCreated) return bCreated - aCreated;
    return new Date(b.startAt).getTime() - new Date(a.startAt).getTime();
  });
}

function ReminderRow({
  title,
  timeLabel,
  status,
  isNew,
}: {
  title: string;
  timeLabel: string;
  status: string;
  isNew?: boolean;
}) {
  return (
    <View style={[styles.reminderRow, isNew ? styles.reminderRowNew : null]}>
      <View style={styles.reminderHeader}>
        <Text style={styles.reminderTitle}>{title}</Text>
        {isNew ? <Text style={styles.newBadge}>New</Text> : null}
      </View>
      <View style={styles.reminderMetaRow}>
        <StatusBadge status={status} />
        <Text style={styles.reminderTime}>{timeLabel}</Text>
      </View>
    </View>
  );
}

export function HomeScreen() {
  const { user, token, logout } = useAuth();
  const [planText, setPlanText] = useState("");
  const [plan, setPlan] = useState<PlanState>({ status: "idle" });
  const [allReminders, setAllReminders] = useState<ReminderSummary[]>([]);
  const [justCreatedIds, setJustCreatedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [showAllReminders, setShowAllReminders] = useState(false);
  const [isLoadingReminders, setIsLoadingReminders] = useState(false);
  const [remindersError, setRemindersError] = useState<string | null>(null);
  const [ping, setPing] = useState<PingState>({ status: "idle" });
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isVoiceBusy, setIsVoiceBusy] = useState(false);
  const isSubmittingRef = useRef(false);

  const timezone = useMemo(
    () => user?.timezone || getDeviceTimezone(),
    [user?.timezone],
  );

  const sortedReminders = useMemo(
    () => sortNewestFirst(allReminders),
    [allReminders],
  );

  const visibleReminders = showAllReminders
    ? sortedReminders
    : sortedReminders.slice(0, RECENT_PREVIEW_COUNT);

  const canShowMore = sortedReminders.length > RECENT_PREVIEW_COUNT;

  const refreshReminders = useCallback(async (authToken: string) => {
    setIsLoadingReminders(true);
    setRemindersError(null);
    try {
      const { reminders } = await listReminders(authToken);
      setAllReminders(reminders);
      // Keep on-device local alerts in sync with future scheduled reminders.
      void syncLocalNotificationsForReminders(reminders);
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Could not load reminders.";
      setRemindersError(message);
    } finally {
      setIsLoadingReminders(false);
    }
  }, []);

  const notifiedPermissionRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      // Feature 6.1: ask once (OS may no-op if already decided).
      void (async () => {
        const allowed = await requestNotificationPermission();
        if (!allowed && !notifiedPermissionRef.current) {
          notifiedPermissionRef.current = true;
          Alert.alert(
            "Notifications are off",
            "Open Android Settings → Apps → Routine Manager → Notifications, turn them ON, then also allow Alarms & reminders if you see that option.",
          );
        }
      })();
      void refreshReminders(token);
    }, [token, refreshReminders]),
  );

  async function applyParseSuccess(
    result: {
      transcript?: string;
      assistantMessage: string;
      created: ReminderSummary[];
    },
    options?: { keepTranscriptInBox?: boolean },
  ) {
    const createdIds = new Set(result.created.map((item) => item.id));
    setJustCreatedIds(createdIds);

    // Schedule local OS notifications for newly created reminders.
    const scheduled = await Promise.all(
      result.created.map((item) => scheduleReminderLocalNotification(item)),
    );
    if (
      result.created.length > 0 &&
      scheduled.every((id) => id == null)
    ) {
      Alert.alert(
        "Reminder saved, but no alert was scheduled",
        "Check that Notifications (and Alarms & reminders) are allowed for Routine Manager in Android Settings, then create another short test reminder.",
      );
    }

    const createdCount = result.created.length;
    const baseMessage = result.assistantMessage || "Reminders processed.";
    const transcriptLine = result.transcript
      ? `Heard: “${result.transcript}”\n\n`
      : "";
    const successMessage =
      createdCount === 0
        ? `${transcriptLine}${baseMessage}\n\nNo new reminders were saved — matching ones already existed.`
        : `${transcriptLine}${baseMessage}`;

    setPlan({
      status: "success",
      message: successMessage,
    });

    if (options?.keepTranscriptInBox && result.transcript) {
      // Leave text so the user can edit and re-submit if needed.
      setPlanText(result.transcript);
    } else {
      setPlanText("");
    }
    setShowAllReminders(false);
  }

  async function handlePlanSubmit() {
    if (isSubmittingRef.current || isVoiceBusy) return;

    const text = planText.trim();
    if (!text) {
      setPlan({
        status: "error",
        message: "Type a plan first — empty text cannot be submitted.",
      });
      return;
    }

    if (!token) {
      setPlan({
        status: "error",
        message: "You are not signed in. Log in again, then retry.",
      });
      return;
    }

    isSubmittingRef.current = true;
    setPlan({ status: "loading" });

    try {
      const result = await parseRoutine(token, { text, timezone });
      await applyParseSuccess(result);
      await refreshReminders(token);
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Could not plan your day. Check the network and try again.";
      setPlan({ status: "error", message });
    } finally {
      isSubmittingRef.current = false;
    }
  }

  async function handleVoiceRecorded(uri: string) {
    if (!token) {
      setPlan({
        status: "error",
        message: "You are not signed in. Log in again, then retry.",
      });
      return;
    }

    setIsVoiceBusy(true);
    setPlan({ status: "loading" });

    try {
      // MVP UX from plan: record → auto-transcribe+parse → show results.
      const result = await parseRoutineAudio(token, {
        uri,
        timezone,
        filename: "routine.m4a",
        mimeType: "audio/mp4",
      });
      await applyParseSuccess(result, { keepTranscriptInBox: true });
      await refreshReminders(token);
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Could not process voice plan. Check mic/network and try again.";
      setPlan({ status: "error", message });
    } finally {
      setIsVoiceBusy(false);
    }
  }

  async function handlePing() {
    if (ping.status === "loading") return;

    setPing({ status: "loading" });

    try {
      const data = await pingHealth();
      setPing({
        status: "success",
        message: `ok: ${String(data.ok)} · service: ${data.service} · ${new Date().toLocaleTimeString()}`,
      });
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Something went wrong while pinging the API.";
      setPing({ status: "error", message });
    }
  }

  async function handleLogout() {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await logout();
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
    >
      <View style={styles.section}>
        <Text style={styles.title}>Plan my day</Text>
        <Text style={styles.subtitle}>
          Signed in as {user?.email ?? "your account"}. Type or speak what you
          want to do; the backend AI turns it into reminders.
        </Text>
        <Text style={styles.meta}>Timezone: {timezone}</Text>
      </View>

      <View style={styles.composer}>
        <Text style={styles.label}>Today&apos;s plan</Text>
        <TextInput
          accessibilityLabel="Plan text"
          multiline
          placeholder="Today: deep work 9–11, call mom at 5pm, stretch at 8pm"
          placeholderTextColor="#a3a3a3"
          style={styles.planInput}
          textAlignVertical="top"
          value={planText}
          editable={plan.status !== "loading" && !isVoiceBusy}
          onChangeText={(next) => {
            setPlanText(next);
            if (plan.status === "error") {
              setPlan({ status: "idle" });
            }
          }}
        />

        <VoicePlanButton
          disabled={plan.status === "loading" || isVoiceBusy}
          onRecorded={handleVoiceRecorded}
          onPermissionDenied={() => {
            setPlan({
              status: "error",
              message:
                "Microphone permission is required for voice plans. Enable it in system Settings for Expo Go / this app, then try again. You can still type a plan below.",
            });
          }}
          onError={(message) => {
            setPlan({ status: "error", message });
          }}
        />

        <Pressable
          accessibilityRole="button"
          disabled={plan.status === "loading" || isVoiceBusy}
          onPress={() => {
            void handlePlanSubmit();
          }}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed ? styles.buttonPressed : null,
            plan.status === "loading" || isVoiceBusy
              ? styles.buttonDisabled
              : null,
          ]}
        >
          {plan.status === "loading" && !isVoiceBusy ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.primaryButtonLabel}>Submit plan</Text>
          )}
        </Pressable>

        {plan.status === "loading" ? (
          <View style={styles.loadingRow}>
            <Text style={styles.loadingText}>
              Talking to the AI and saving reminders…
            </Text>
          </View>
        ) : null}

        {plan.status === "error" ? (
          <View style={[styles.result, styles.resultError]}>
            <Text style={styles.resultLabel}>Error</Text>
            <Text style={styles.resultBody}>{plan.message}</Text>
          </View>
        ) : null}

        {plan.status === "success" ? (
          <View style={[styles.result, styles.resultSuccess]}>
            <Text style={styles.resultLabel}>Saved</Text>
            <Text style={styles.resultBody}>{plan.message}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          {showAllReminders
            ? `All reminders (${sortedReminders.length})`
            : `Recent reminders (${Math.min(RECENT_PREVIEW_COUNT, sortedReminders.length)} of ${sortedReminders.length})`}
        </Text>

        {isLoadingReminders && sortedReminders.length === 0 ? (
          <ActivityIndicator color="#2563eb" />
        ) : null}

        {remindersError ? (
          <View style={[styles.result, styles.resultError]}>
            <Text style={styles.resultLabel}>Could not load reminders</Text>
            <Text style={styles.resultBody}>{remindersError}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (token) void refreshReminders(token);
              }}
            >
              <Text style={styles.linkLabel}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {!remindersError && sortedReminders.length === 0 && !isLoadingReminders ? (
          <Text style={styles.emptyText}>
            No reminders yet. Submit a plan above to create some.
          </Text>
        ) : null}

        <View style={styles.reminderList}>
          {visibleReminders.map((item) => {
            const startLabel = formatReminderTime(
              item.startAt,
              item.timezone || timezone,
            );
            const endLabel = item.endAt
              ? ` → ${formatReminderTime(item.endAt, item.timezone || timezone)}`
              : "";
            return (
                <ReminderRow
                  key={item.id}
                  title={item.title}
                  timeLabel={`${startLabel}${endLabel}`}
                  status={item.status}
                  isNew={justCreatedIds.has(item.id)}
                />
            );
          })}
        </View>

        {canShowMore ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowAllReminders((prev) => !prev)}
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed ? styles.buttonPressed : null,
            ]}
          >
            <Text style={styles.secondaryButtonLabel}>
              {showAllReminders
                ? "Show less"
                : `Show more (${sortedReminders.length - RECENT_PREVIEW_COUNT} more)`}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.divider} />

      <Pressable
        accessibilityRole="button"
        disabled={ping.status === "loading"}
        onPress={handlePing}
        style={({ pressed }) => [
          styles.secondaryButton,
          pressed ? styles.buttonPressed : null,
          ping.status === "loading" ? styles.buttonDisabled : null,
        ]}
      >
        {ping.status === "loading" ? (
          <ActivityIndicator color="#2563eb" />
        ) : (
          <Text style={styles.secondaryButtonLabel}>Ping API</Text>
        )}
      </Pressable>

      {ping.status === "success" ? (
        <View style={[styles.result, styles.resultSuccess]}>
          <Text style={styles.resultLabel}>Success</Text>
          <Text style={styles.resultBody}>{ping.message}</Text>
        </View>
      ) : null}

      {ping.status === "error" ? (
        <View style={[styles.result, styles.resultError]}>
          <Text style={styles.resultLabel}>Error</Text>
          <Text style={styles.resultBody}>{ping.message}</Text>
        </View>
      ) : null}

      <Pressable
        accessibilityRole="button"
        disabled={isLoggingOut}
        onPress={handleLogout}
        style={({ pressed }) => [
          styles.secondaryButton,
          pressed ? styles.buttonPressed : null,
        ]}
      >
        {isLoggingOut ? (
          <ActivityIndicator color="#2563eb" />
        ) : (
          <Text style={styles.secondaryButtonLabel}>Log out</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    gap: 16,
    paddingBottom: 40,
  },
  section: {
    gap: 8,
  },
  composer: {
    gap: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 22,
    color: "#525252",
  },
  meta: {
    fontSize: 13,
    color: "#737373",
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#404040",
  },
  planInput: {
    minHeight: 120,
    borderWidth: 1,
    borderColor: "#d4d4d4",
    borderRadius: 12,
    borderCurve: "continuous",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    lineHeight: 22,
    backgroundColor: "#ffffff",
  },
  primaryButton: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2563eb",
    borderRadius: 12,
    borderCurve: "continuous",
    minHeight: 48,
    paddingHorizontal: 16,
  },
  primaryButtonLabel: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  loadingText: {
    color: "#525252",
    flex: 1,
  },
  reminderList: {
    gap: 8,
  },
  reminderRow: {
    borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 12,
    borderCurve: "continuous",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
    backgroundColor: "#fafafa",
  },
  reminderRowNew: {
    borderColor: "#86efac",
    backgroundColor: "#f0fdf4",
  },
  reminderHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  reminderTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#171717",
    flex: 1,
  },
  newBadge: {
    fontSize: 12,
    fontWeight: "700",
    color: "#15803d",
  },
  reminderMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  reminderTime: {
    fontSize: 14,
    color: "#525252",
    flexShrink: 1,
  },
  emptyText: {
    color: "#737373",
    lineHeight: 20,
  },
  linkLabel: {
    marginTop: 8,
    color: "#2563eb",
    fontWeight: "600",
  },
  secondaryButton: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderCurve: "continuous",
    minHeight: 48,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: "#2563eb",
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  secondaryButtonLabel: {
    color: "#2563eb",
    fontSize: 16,
    fontWeight: "600",
  },
  result: {
    borderRadius: 12,
    borderCurve: "continuous",
    padding: 14,
    gap: 4,
  },
  resultSuccess: {
    backgroundColor: "#ecfdf5",
  },
  resultError: {
    backgroundColor: "#fef2f2",
  },
  resultLabel: {
    fontWeight: "700",
  },
  resultBody: {
    color: "#404040",
    lineHeight: 20,
  },
  divider: {
    height: 1,
    backgroundColor: "#e5e5e5",
    marginVertical: 4,
  },
});
