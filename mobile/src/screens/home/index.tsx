import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  View,
} from "react-native";
import { ApiError, pingHealth } from "@/api/client";
import { sendTestPush } from "@/api/notifications";
import {
  listReminders,
  parseRoutine,
  parseRoutineAudio,
  type ReminderSummary,
} from "@/api/routines";
import { useAuth } from "@/auth/AuthContext";
import { StatusBadge } from "@/components/status-badge";
import { AppButton } from "@/components/ui/app-button";
import { AppTextField } from "@/components/ui/app-text-field";
import { FeedbackBanner } from "@/components/ui/feedback-banner";
import { ScreenScroll, ScreenSection } from "@/components/ui/screen";
import { ThemedText } from "@/components/ui/themed-text";
import { VoicePlanButton } from "@/components/voice-plan-button";
import {
  cancelReminderLocalNotification,
  requestNotificationPermission,
  rescheduleReminderLocalNotification,
  scheduleReminderLocalNotification,
  syncLocalNotificationsForReminders,
} from "@/notifications/local-reminders";
import { colors, radius, shadows, spacing } from "@/theme";

type PingState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

type TestPushState =
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
        <ThemedText variant="headline" style={styles.reminderTitle}>
          {title}
        </ThemedText>
        {isNew ? (
          <ThemedText variant="caption" style={styles.newBadge}>
            New
          </ThemedText>
        ) : null}
      </View>
      <View style={styles.reminderMetaRow}>
        <StatusBadge status={status} />
        <ThemedText variant="caption" style={styles.reminderTime}>
          {timeLabel}
        </ThemedText>
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
  const [testPush, setTestPush] = useState<TestPushState>({ status: "idle" });
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
      updated?: ReminderSummary[];
      deleted?: Array<{ id: string }>;
    },
    options?: { keepTranscriptInBox?: boolean },
  ) {
    const created = result.created ?? [];
    const updated = result.updated ?? [];
    const deleted = result.deleted ?? [];

    const createdIds = new Set(created.map((item) => item.id));
    setJustCreatedIds(createdIds);

    // Feature 7.1: keep OS local alerts aligned with create / update / delete.
    await Promise.all([
      ...created.map((item) => scheduleReminderLocalNotification(item)),
      ...updated.map(async (item) => {
        if (item.status === "scheduled") {
          await rescheduleReminderLocalNotification(item);
        } else {
          // cancelled / completed → no future local ping
          await cancelReminderLocalNotification(item.id);
        }
      }),
      ...deleted.map((item) => cancelReminderLocalNotification(item.id)),
    ]);

    const changedCount = created.length + updated.length + deleted.length;
    const baseMessage = result.assistantMessage || "Reminders processed.";
    const transcriptLine = result.transcript
      ? `Heard: “${result.transcript}”\n\n`
      : "";

    let successMessage = `${transcriptLine}${baseMessage}`;
    if (changedCount === 0) {
      successMessage = `${transcriptLine}${baseMessage}\n\nNo reminders were created, updated, or deleted.`;
    }

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

  /** Feature 6.3 — backend → Expo Push → FCM → this phone. */
  async function handleTestPush() {
    if (testPush.status === "loading") return;
    if (!token) {
      setTestPush({
        status: "error",
        message: "You are not signed in. Log in again, then retry.",
      });
      return;
    }

    setTestPush({ status: "loading" });

    try {
      const result = await sendTestPush(token);
      if (!result.ok || result.sent < 1) {
        const detail =
          result.errors.length > 0
            ? result.errors.join("; ")
            : "Expo accepted no tickets.";
        setTestPush({
          status: "error",
          message: `Push not delivered (${detail})`,
        });
        return;
      }

      setTestPush({
        status: "success",
        message: `Sent ${result.sent} push(es) to ${result.deviceCount} device(s). Check the notification shade (app can stay open or backgrounded).`,
      });
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.message
          : "Could not send test push. Is the backend running?";
      setTestPush({ status: "error", message });
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
    <ScreenScroll>
      <ScreenSection>
        <ThemedText variant="largeTitle">Plan &amp; manage</ThemedText>
        <ThemedText variant="subhead">
          Signed in as {user?.email ?? "your account"}. Create reminders, or
          manage existing ones in plain language (e.g. move, cancel, delete).
        </ThemedText>
        <ThemedText variant="caption">Timezone: {timezone}</ThemedText>
      </ScreenSection>

      <View style={styles.card}>
        <ThemedText variant="label">Say what to create or change</ThemedText>
        <AppTextField
          accessibilityLabel="Plan or manage text"
          multiline
          placeholder="Create: Gym at 7am · Manage: Move gym to 8am · Delete gym"
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

        <AppButton
          label="Submit plan"
          loading={plan.status === "loading" && !isVoiceBusy}
          disabled={plan.status === "loading" || isVoiceBusy}
          onPress={() => {
            void handlePlanSubmit();
          }}
        />

        {plan.status === "loading" ? (
          <ThemedText variant="caption">
            Talking to the AI and saving reminders…
          </ThemedText>
        ) : null}

        {plan.status === "error" ? (
          <FeedbackBanner tone="error" title="Error" body={plan.message} />
        ) : null}

        {plan.status === "success" ? (
          <FeedbackBanner tone="success" title="Saved" body={plan.message} />
        ) : null}
      </View>

      <ScreenSection>
        <ThemedText variant="title">
          {showAllReminders
            ? `All reminders (${sortedReminders.length})`
            : `Recent reminders (${Math.min(RECENT_PREVIEW_COUNT, sortedReminders.length)} of ${sortedReminders.length})`}
        </ThemedText>

        {isLoadingReminders && sortedReminders.length === 0 ? (
          <ActivityIndicator color={colors.tint} />
        ) : null}

        {remindersError ? (
          <FeedbackBanner
            tone="error"
            title="Could not load reminders"
            body={remindersError}
            actionLabel="Retry"
            onAction={() => {
              if (token) void refreshReminders(token);
            }}
          />
        ) : null}

        {!remindersError &&
        sortedReminders.length === 0 &&
        !isLoadingReminders ? (
          <ThemedText variant="subhead">
            No reminders yet. Submit a plan above to create some.
          </ThemedText>
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
          <AppButton
            label={
              showAllReminders
                ? "Show less"
                : `Show more (${sortedReminders.length - RECENT_PREVIEW_COUNT} more)`
            }
            variant="ghost"
            onPress={() => setShowAllReminders((prev) => !prev)}
          />
        ) : null}
      </ScreenSection>

      <View style={styles.divider} />

      <View style={styles.tools}>
        <ThemedText variant="label">Developer tools</ThemedText>
        <AppButton
          label="Ping API"
          variant="secondary"
          loading={ping.status === "loading"}
          onPress={() => {
            void handlePing();
          }}
        />

        {ping.status === "success" ? (
          <FeedbackBanner tone="success" title="Success" body={ping.message} />
        ) : null}

        {ping.status === "error" ? (
          <FeedbackBanner tone="error" title="Error" body={ping.message} />
        ) : null}

        <AppButton
          label="Send test push"
          variant="secondary"
          loading={testPush.status === "loading"}
          disabled={!token}
          onPress={() => {
            void handleTestPush();
          }}
        />

        {testPush.status === "success" ? (
          <FeedbackBanner
            tone="success"
            title="Test push"
            body={testPush.message}
          />
        ) : null}

        {testPush.status === "error" ? (
          <FeedbackBanner
            tone="error"
            title="Test push error"
            body={testPush.message}
          />
        ) : null}

        <AppButton
          label="Log out"
          variant="ghost"
          loading={isLoggingOut}
          onPress={() => {
            void handleLogout();
          }}
        />
      </View>
    </ScreenScroll>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm + 4,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderCurve: "continuous",
    backgroundColor: colors.secondaryGroupedBackground,
    boxShadow: shadows.subtle,
  },
  planInput: {
    minHeight: 120,
  },
  reminderList: {
    gap: spacing.sm,
  },
  reminderRow: {
    borderRadius: radius.md,
    borderCurve: "continuous",
    paddingHorizontal: spacing.md - 2,
    paddingVertical: spacing.sm + 4,
    gap: spacing.xs,
    backgroundColor: colors.secondaryGroupedBackground,
  },
  reminderRowNew: {
    backgroundColor: "rgba(5, 150, 105, 0.10)",
  },
  reminderHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  reminderTitle: {
    flex: 1,
  },
  newBadge: {
    fontWeight: "700",
    color: colors.success,
  },
  reminderMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  reminderTime: {
    flexShrink: 1,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.separator,
  },
  tools: {
    gap: spacing.sm,
  },
});
