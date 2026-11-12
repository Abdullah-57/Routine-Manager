import { AudioModule } from "expo-audio";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError, pingHealth } from "@/api/client";
import { sendTestPush } from "@/api/notifications";
import {
  listReminders,
  parseRoutine,
  transcribeRoutineAudio,
  type ReminderSummary,
} from "@/api/routines";
import { useAuth } from "@/auth/AuthContext";
import { AiPlanComposer } from "@/components/ai-plan-composer";
import { AssistantResponseCard } from "@/components/assistant-response-card";
import { HomeSidebar } from "@/components/home-sidebar";
import { StatusBadge } from "@/components/status-badge";
import { AppButton } from "@/components/ui/app-button";
import { FeedbackBanner } from "@/components/ui/feedback-banner";
import { VoiceRecordSheet } from "@/components/voice-record-sheet";
import {
  cancelReminderLocalNotification,
  requestNotificationPermission,
  rescheduleReminderLocalNotification,
  scheduleReminderLocalNotification,
  syncLocalNotificationsForReminders,
} from "@/notifications/local-reminders";
import { useAppPreferences } from "@/preferences/app-preferences";
import { radius, shadows, spacing } from "@/theme";

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

function getDeviceTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function formatReminderTime(
  iso: string,
  timezone: string,
  use24HourClock: boolean,
) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: !use24HourClock,
    }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: !use24HourClock,
    }).format(new Date(iso));
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

function welcomeName(user: {
  displayName?: string;
  email?: string;
} | null) {
  const display = user?.displayName?.trim();
  if (display) return display;
  const email = user?.email?.trim();
  if (email) return email.split("@")[0] || email;
  return "there";
}

function avatarLetter(user: {
  displayName?: string;
  email?: string;
} | null) {
  const name = welcomeName(user);
  return name.charAt(0).toUpperCase() || "R";
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
  const prefs = useAppPreferences();
  const insets = useSafeAreaInsets();

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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [voiceSheetOpen, setVoiceSheetOpen] = useState(false);
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
  const busy = plan.status === "loading" || isVoiceBusy;

  const refreshReminders = useCallback(async (authToken: string) => {
    setIsLoadingReminders(true);
    setRemindersError(null);
    try {
      const { reminders } = await listReminders(authToken);
      setAllReminders(reminders);
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
      void (async () => {
        if (!prefs.pushNotificationsEnabled) return;
        const allowed = await requestNotificationPermission();
        if (!allowed && !notifiedPermissionRef.current) {
          notifiedPermissionRef.current = true;
          Alert.alert(
            "Notifications are off",
            Platform.OS === "ios"
              ? "Open Settings → Notifications → Routine Manager and turn Allow Notifications ON."
              : "Open Android Settings → Apps → Routine Manager → Notifications, turn them ON, then also allow Alarms & reminders if you see that option.",
          );
        }
      })();
      void refreshReminders(token);
    }, [token, refreshReminders, prefs.pushNotificationsEnabled]),
  );

  async function applyParseSuccess(result: {
    transcript?: string;
    assistantMessage: string;
    created: ReminderSummary[];
    updated?: ReminderSummary[];
    deleted?: Array<{ id: string }>;
  }) {
    const created = result.created ?? [];
    const updated = result.updated ?? [];
    const deleted = result.deleted ?? [];

    setJustCreatedIds(new Set(created.map((item) => item.id)));

    await Promise.all([
      ...created.map((item) => scheduleReminderLocalNotification(item)),
      ...updated.map(async (item) => {
        if (item.status === "scheduled") {
          await rescheduleReminderLocalNotification(item);
        } else {
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
    setPlanText("");
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
      const result = await transcribeRoutineAudio(token, {
        uri,
        mimeType: "audio/mp4",
      });
      setPlanText(result.transcript);
      setPlan({ status: "idle" });
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

  async function handleTestPush() {
    if (testPush.status === "loading") return;
    if (!token) {
      setTestPush({
        status: "error",
        message: "You are not signed in. Log in again, then retry.",
      });
      return;
    }
    if (!prefs.pushNotificationsEnabled) {
      setTestPush({
        status: "error",
        message: "Enable Push Notifications in the sidebar first.",
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
      setSidebarOpen(false);
      await logout();
    } finally {
      setIsLoggingOut(false);
    }
  }

  async function handleToggleMicrophone(value: boolean) {
    if (value) {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          "Microphone permission needed",
          "Enable the microphone in system Settings to use voice plans.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Open Settings",
              onPress: () => {
                void Linking.openSettings();
              },
            },
          ],
        );
        await prefs.setMicrophoneEnabled(false);
        return;
      }
    }
    await prefs.setMicrophoneEnabled(value);
  }

  async function handleTogglePush(value: boolean) {
    if (value) {
      const allowed = await requestNotificationPermission();
      if (!allowed) {
        Alert.alert(
          "Notifications are off",
          "Enable notifications in system Settings to receive reminders.",
          [
            { text: "Cancel", style: "cancel" },
            {
              text: "Open Settings",
              onPress: () => {
                void Linking.openSettings();
              },
            },
          ],
        );
        await prefs.setPushNotificationsEnabled(false);
        return;
      }
    }
    await prefs.setPushNotificationsEnabled(value);
  }

  return (
    <View style={styles.root}>
      <View style={styles.headerGlow} pointerEvents="none" />

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.md, paddingBottom: spacing.xxl },
        ]}
      >
        <View style={styles.topRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open settings sidebar"
            onPress={() => setSidebarOpen(true)}
            style={({ pressed }) => [
              styles.avatar,
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={styles.avatarLetter}>{avatarLetter(user)}</Text>
          </Pressable>

          <View style={styles.welcomeBlock}>
            <Text style={styles.welcomeEyebrow}>Routine Manager</Text>
            <Text style={styles.welcomeTitle}>
              Welcome {welcomeName(user)}
            </Text>
          </View>
        </View>

        <View style={styles.composerCard}>
          <AiPlanComposer
            value={planText}
            onChangeText={(next) => {
              setPlanText(next);
              if (plan.status === "error") {
                setPlan({ status: "idle" });
              }
            }}
            onPressMic={() => {
              if (!prefs.microphoneEnabled) {
                setPlan({
                  status: "error",
                  message:
                    "Microphone Access is turned off in Settings. Enable it in the sidebar to use voice input.",
                });
                return;
              }
              setVoiceSheetOpen(true);
            }}
            onSubmit={() => {
              void handlePlanSubmit();
            }}
            editable={!busy}
            submitting={plan.status === "loading" && !isVoiceBusy}
            micDisabled={!prefs.microphoneEnabled || busy}
          />

          {busy ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color="#1D4ED8" />
              <Text style={styles.loadingText}>
                {isVoiceBusy
                  ? "Transcribing your voice…"
                  : "Generating reminders…"}
              </Text>
            </View>
          ) : null}

          {plan.status === "error" ? (
            <FeedbackBanner tone="error" title="Error" body={plan.message} />
          ) : null}

          {plan.status === "success" ? (
            <AssistantResponseCard message={plan.message} />
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            {showAllReminders
              ? `All reminders (${sortedReminders.length})`
              : `Recent reminders (${Math.min(RECENT_PREVIEW_COUNT, sortedReminders.length)} of ${sortedReminders.length})`}
          </Text>

          {isLoadingReminders && sortedReminders.length === 0 ? (
            <ActivityIndicator color="#1D4ED8" />
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
            <Text style={styles.emptyText}>
              No reminders yet. Submit a plan above to create some.
            </Text>
          ) : null}

          <View style={styles.reminderList}>
            {visibleReminders.map((item) => {
              const startLabel = formatReminderTime(
                item.startAt,
                item.timezone || timezone,
                prefs.use24HourClock,
              );
              const endLabel = item.endAt
                ? ` → ${formatReminderTime(item.endAt, item.timezone || timezone, prefs.use24HourClock)}`
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
        </View>
      </ScrollView>

      <HomeSidebar
        visible={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        microphoneEnabled={prefs.microphoneEnabled}
        pushNotificationsEnabled={prefs.pushNotificationsEnabled}
        use24HourClock={prefs.use24HourClock}
        onToggleMicrophone={(value) => {
          void handleToggleMicrophone(value);
        }}
        onTogglePush={(value) => {
          void handleTogglePush(value);
        }}
        onToggle24Hour={(value) => {
          void prefs.setUse24HourClock(value);
        }}
        ping={ping}
        testPush={testPush}
        onPing={() => {
          void handlePing();
        }}
        onTestPush={() => {
          void handleTestPush();
        }}
        onLogout={() => {
          void handleLogout();
        }}
        isLoggingOut={isLoggingOut}
      />

      <VoiceRecordSheet
        isPresented={voiceSheetOpen}
        onDismiss={() => setVoiceSheetOpen(false)}
        onRecorded={handleVoiceRecorded}
        onPermissionDenied={() => {
          setPlan({
            status: "error",
            message:
              "Microphone permission is required for voice plans. Enable it in system Settings, then try again. You can still type a plan.",
          });
        }}
        onError={(message) => {
          setPlan({ status: "error", message });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  headerGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 180,
    experimental_backgroundImage: `
      linear-gradient(180deg, rgba(147, 197, 253, 0.55) 0%, rgba(59, 130, 246, 0.18) 55%, rgba(255, 255, 255, 0) 100%)
    `,
  },
  content: {
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1D4ED8",
    boxShadow: shadows.subtle,
  },
  avatarLetter: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "700",
  },
  welcomeBlock: {
    flex: 1,
    gap: 2,
  },
  welcomeEyebrow: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
    color: "#2563EB",
    textTransform: "uppercase",
  },
  welcomeTitle: {
    fontSize: 26,
    fontWeight: "700",
    letterSpacing: -0.4,
    color: "#0F172A",
  },
  composerCard: {
    gap: spacing.sm + 2,
    padding: spacing.md,
    borderRadius: radius.xl,
    borderCurve: "continuous",
    backgroundColor: "#FFFFFF",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(37, 99, 235, 0.18)",
    boxShadow: shadows.subtle,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  loadingText: {
    flex: 1,
    color: "#475569",
    fontSize: 14,
  },
  section: {
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1E3A8A",
  },
  emptyText: {
    color: "#64748B",
    lineHeight: 20,
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
    backgroundColor: "rgba(37, 99, 235, 0.05)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(37, 99, 235, 0.12)",
  },
  reminderRowNew: {
    backgroundColor: "rgba(37, 99, 235, 0.12)",
    borderColor: "rgba(37, 99, 235, 0.35)",
  },
  reminderHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  reminderTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: "#0F172A",
  },
  newBadge: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1D4ED8",
  },
  reminderMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  reminderTime: {
    fontSize: 13,
    color: "#64748B",
    flexShrink: 1,
  },
  pressed: {
    opacity: 0.88,
  },
});
