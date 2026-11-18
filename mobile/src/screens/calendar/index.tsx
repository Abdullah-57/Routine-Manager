import { AudioModule } from "expo-audio";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn } from "react-native-reanimated";
import { ApiError, pingHealth } from "@/api/client";
import { sendTestPush } from "@/api/notifications";
import { listReminders, type ReminderSummary } from "@/api/reminders";
import { useAuth } from "@/auth/AuthContext";
import { DayTimeline } from "@/components/day-timeline";
import { HomeSidebar } from "@/components/home-sidebar";
import { MonthCalendar } from "@/components/month-calendar";
import { FeedbackBanner } from "@/components/ui/feedback-banner";
import { ThemedText } from "@/components/ui/themed-text";
import {
  compareRemindersByStartAscending,
  dateKeyInTimezone,
  formatTimeOnly,
  monthRangeISO,
  todayDateKey,
} from "@/utils/reminder-time";
import { requestNotificationPermission } from "@/notifications/local-reminders";
import { useAppPreferences } from "@/preferences/app-preferences";
import { motion, radius, shadows, spacing } from "@/theme";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "refreshing" }
  | { status: "error"; message: string };

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

function getDeviceTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
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

/**
 * Friendly empty/error card for list/calendar states.
 */
function EmptyStateCard({
  icon,
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon: string;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <Animated.View
      entering={FadeIn.duration(motion.enterMs).easing(motion.easeOut)}
      style={styles.emptyCard}
    >
      <Text style={styles.emptyIcon}>{icon}</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          style={({ pressed }) => [
            styles.emptyAction,
            pressed ? styles.emptyActionPressed : null,
          ]}
        >
          <Text style={styles.emptyActionLabel}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

export function CalendarScreen() {
  const { user, token, logout } = useAuth();
  const { push } = useRouter();
  const prefs = useAppPreferences();
  const insets = useSafeAreaInsets();
  const timezone = user?.timezone || getDeviceTimezone();

  const [selectedDate, setSelectedDate] = useState(() =>
    todayDateKey(timezone),
  );
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const [y, m] = todayDateKey(timezone).split("-").map(Number);
    return { year: y, month: m };
  });
  const [monthReminders, setMonthReminders] = useState<ReminderSummary[]>([]);
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [ping, setPing] = useState<PingState>({ status: "idle" });
  const [testPush, setTestPush] = useState<TestPushState>({ status: "idle" });
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isCalendarCollapsed, setIsCalendarCollapsed] = useState(false);
  // Double-submit guard: focus effect, pull-to-refresh and the Retry button
  // all trigger fetchMonth — never let two fetches overlap.
  const fetchInFlightRef = useRef(false);

  const fetchMonth = useCallback(
    async (year: number, month: number, mode: "loading" | "refreshing") => {
      if (!token || fetchInFlightRef.current) return;

      fetchInFlightRef.current = true;
      setLoad({ status: mode });
      try {
        const range = monthRangeISO(year, month, timezone);
        const { reminders } = await listReminders(token, range);
        setMonthReminders(reminders);
        setLoad({ status: "idle" });
      } catch (error) {
        const message =
          error instanceof ApiError
            ? error.message
            : "Could not load calendar reminders.";
        setLoad({ status: "error", message });
      } finally {
        fetchInFlightRef.current = false;
      }
    },
    [token, timezone],
  );

  const retryFetchMonth = useCallback(() => {
    void fetchMonth(visibleMonth.year, visibleMonth.month, "refreshing");
  }, [fetchMonth, visibleMonth.year, visibleMonth.month]);

  useFocusEffect(
    useCallback(() => {
      void fetchMonth(visibleMonth.year, visibleMonth.month, "loading");
    }, [fetchMonth, visibleMonth.year, visibleMonth.month]),
  );

  const markedDates = useMemo(() => {
    const marks: Record<string, boolean> = {};
    for (const item of monthReminders) {
      // Same TZ as Home/detail: each reminder's stored timezone (fallback: account/device).
      const key = dateKeyInTimezone(
        item.startAt,
        item.timezone || timezone,
      );
      marks[key] = true;
    }
    return marks;
  }, [monthReminders, timezone]);

  const dayReminders = useMemo(() => {
    // Applies to ALL reminders (old and new): earliest startAt at top.
    return monthReminders
      .filter(
        (item) =>
          dateKeyInTimezone(item.startAt, item.timezone || timezone) ===
          selectedDate,
      )
      .slice()
      .sort(compareRemindersByStartAscending);
  }, [monthReminders, selectedDate, timezone]);

  const onPressReminder = useCallback(
    (id: string) => {
      push({
        pathname: "/reminder/[id]",
        params: { id },
      });
    },
    [push],
  );

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

  const isSelectedToday = selectedDate === todayDateKey(timezone);

  return (
    <View style={styles.root}>
      <View style={styles.headerGlow} pointerEvents="none" />

      {/* Top Header & Calendar Section */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
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

        {!isCalendarCollapsed ? (
          <MonthCalendar
            year={visibleMonth.year}
            month={visibleMonth.month}
            selectedDate={selectedDate}
            markedDates={markedDates}
            onSelectDate={setSelectedDate}
            onChangeMonth={(year, month) => {
              setVisibleMonth({ year, month });
              // Keep selection inside the new month when possible
              const day = Number(selectedDate.split("-")[2] || "1");
              const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
              const clamped = Math.min(day, daysInMonth);
              setSelectedDate(
                `${year}-${String(month).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`,
              );
            }}
          />
        ) : null}

        {/* Timeline Header Row with Title, Event Count, Today jump, and Calendar toggle */}
        <View style={styles.timelineHeaderRow}>
          <View style={styles.timelineTitleGroup}>
            <ThemedText variant="title" style={styles.sectionTitle}>
              {selectedDate}
            </ThemedText>
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>
                {dayReminders.length === 0
                  ? "0 events"
                  : `${dayReminders.length} event${dayReminders.length > 1 ? "s" : ""}`}
              </Text>
            </View>
          </View>

          <View style={styles.timelineActions}>
            {!isSelectedToday ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Jump to today"
                onPress={() => {
                  const today = todayDateKey(timezone);
                  setSelectedDate(today);
                  const [y, m] = today.split("-").map(Number);
                  setVisibleMonth({ year: y, month: m });
                }}
                style={({ pressed }) => [
                  styles.todayBtn,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Text style={styles.todayBtnText}>Today</Text>
              </Pressable>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isCalendarCollapsed ? "Show month calendar" : "Hide month calendar"}
              onPress={() => setIsCalendarCollapsed((prev) => !prev)}
              style={({ pressed }) => [
                styles.collapseBtn,
                pressed ? styles.pressed : null,
              ]}
            >
              <Text style={styles.collapseBtnText}>
                {isCalendarCollapsed ? "Show Month ▼" : "Hide Month ▲"}
              </Text>
            </Pressable>
          </View>
        </View>

        {load.status === "error" && dayReminders.length > 0 ? (
          <FeedbackBanner
            tone="error"
            title="Could not refresh"
            body={load.message}
            actionLabel="Retry"
            onAction={retryFetchMonth}
          />
        ) : null}
      </View>

      {/* Main 24-Hour Timeline */}
      <View style={styles.timelineContainer}>
        {load.status === "error" && monthReminders.length === 0 ? (
          <EmptyStateCard
            icon="⚠️"
            title="Couldn't load calendar"
            body="The calendar couldn't reach the server. Check your connection, then try again."
            actionLabel="Try again"
            onAction={retryFetchMonth}
          />
        ) : load.status === "loading" && monthReminders.length === 0 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color="#1D4ED8" size="large" />
            <Text style={styles.loadingText}>Loading calendar...</Text>
          </View>
        ) : (
          <DayTimeline
            dateKey={selectedDate}
            reminders={dayReminders}
            timezone={timezone}
            use24HourClock={prefs.use24HourClock}
            onPressReminder={onPressReminder}
            onRefresh={retryFetchMonth}
            refreshing={load.status === "refreshing"}
          />
        )}
      </View>

      <HomeSidebar
        visible={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        microphoneEnabled={prefs.microphoneEnabled}
        pushNotificationsEnabled={prefs.pushNotificationsEnabled}
        use24HourClock={prefs.use24HourClock}
        assistantEnabled={prefs.assistantEnabled}
        wakePhrase={prefs.wakePhrase}
        wakeSensitivity={prefs.wakeSensitivity}
        isAssistantListening={prefs.assistantEnabled && prefs.microphoneEnabled}
        onToggleMicrophone={(value) => {
          void handleToggleMicrophone(value);
        }}
        onTogglePush={(value) => {
          void handleTogglePush(value);
        }}
        onToggle24Hour={(value) => {
          void prefs.setUse24HourClock(value);
        }}
        onToggleAssistant={(value) => {
          void prefs.setAssistantEnabled(value);
        }}
        onChangeWakeSensitivity={(value) => {
          void prefs.setWakeSensitivity(value);
        }}
        spokenFeedbackEnabled={prefs.spokenFeedbackEnabled}
        onToggleSpokenFeedback={(value) => {
          void prefs.setSpokenFeedbackEnabled(value);
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
  header: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
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
  sectionTitle: {
    color: "#1E3A8A",
  },
  timelineHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.xs,
    paddingVertical: 4,
  },
  timelineTitleGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: "rgba(37, 99, 235, 0.1)",
  },
  countBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#2563EB",
  },
  timelineActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  todayBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.full,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.2)",
  },
  todayBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#2563EB",
  },
  collapseBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.full,
    backgroundColor: "#F1F5F9",
  },
  collapseBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#475569",
  },
  timelineContainer: {
    flex: 1,
    marginTop: spacing.xs,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xxl,
  },
  loadingText: {
    fontSize: 14,
    color: "#64748B",
    fontWeight: "500",
  },
  emptyCard: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm + 4,
    alignItems: "center",
    gap: spacing.xs,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderCurve: "continuous",
    backgroundColor: "rgba(37, 99, 235, 0.05)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(37, 99, 235, 0.12)",
  },
  emptyIcon: {
    fontSize: 34,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#0F172A",
  },
  emptyBody: {
    fontSize: 14,
    lineHeight: 20,
    color: "#64748B",
    textAlign: "center",
  },
  emptyAction: {
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm - 2,
    borderRadius: radius.full,
    backgroundColor: "#1D4ED8",
  },
  emptyActionPressed: {
    opacity: 0.85,
  },
  emptyActionLabel: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  emptySpinner: {
    marginTop: spacing.lg,
  },
  pressed: {
    opacity: 0.88,
  },
});
