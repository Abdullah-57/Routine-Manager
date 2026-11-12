import { AudioModule } from "expo-audio";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError, pingHealth } from "@/api/client";
import { sendTestPush } from "@/api/notifications";
import { listReminders, type ReminderSummary } from "@/api/reminders";
import { useAuth } from "@/auth/AuthContext";
import { HomeSidebar } from "@/components/home-sidebar";
import { MonthCalendar } from "@/components/month-calendar";
import { StatusBadge } from "@/components/status-badge";
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
import { radius, shadows, spacing } from "@/theme";

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

function AgendaRow({
  id,
  title,
  timeLabel,
  notes,
  status,
  onPressId,
}: {
  id: string;
  title: string;
  timeLabel: string;
  notes: string;
  status: string;
  onPressId: (id: string) => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onPressId(id)}
      style={({ pressed }) => [
        styles.agendaRow,
        pressed ? styles.agendaRowPressed : null,
      ]}
    >
      <ThemedText variant="headline" style={styles.agendaTime}>
        {timeLabel}
      </ThemedText>
      <View style={styles.agendaBody}>
        <View style={styles.agendaTitleRow}>
          <ThemedText variant="headline" style={styles.agendaTitle}>
            {title}
          </ThemedText>
          <StatusBadge status={status} />
        </View>
        {notes ? (
          <ThemedText
            variant="caption"
            numberOfLines={2}
            style={styles.agendaNotes}
          >
            {notes}
          </ThemedText>
        ) : null}
      </View>
    </Pressable>
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

  const fetchMonth = useCallback(
    async (year: number, month: number, mode: "loading" | "refreshing") => {
      if (!token) return;

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
      }
    },
    [token, timezone],
  );

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

  const listHeader = (
    <View style={styles.header}>
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

      <ThemedText variant="title" style={styles.sectionTitle}>
        Agenda · {selectedDate}
      </ThemedText>

      {load.status === "error" ? (
        <FeedbackBanner
          tone="error"
          title="Could not refresh"
          body={load.message}
          actionLabel="Retry"
          onAction={() =>
            void fetchMonth(
              visibleMonth.year,
              visibleMonth.month,
              "refreshing",
            )
          }
        />
      ) : null}
    </View>
  );

  return (
    <View style={styles.root}>
      <View style={styles.headerGlow} pointerEvents="none" />

      <FlatList
        data={dayReminders}
        keyExtractor={(item) => item.id}
        style={styles.list}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: insets.top + spacing.md },
        ]}
        ListHeaderComponent={listHeader}
        refreshControl={
          <RefreshControl
            refreshing={load.status === "refreshing"}
            onRefresh={() =>
              void fetchMonth(
                visibleMonth.year,
                visibleMonth.month,
                "refreshing",
              )
            }
            tintColor="#1D4ED8"
            colors={["#2563EB"]}
          />
        }
        ListEmptyComponent={
          load.status === "loading" ? (
            <ActivityIndicator color="#1D4ED8" style={styles.emptySpinner} />
          ) : (
            <ThemedText variant="subhead" style={styles.emptyText}>
              No reminders on this day. Create some from Home, then pull to
              refresh.
            </ThemedText>
          )
        }
        renderItem={({ item }) => {
          // Must match Home: format in the reminder's own timezone, not only account/device.
          // Otherwise 15:00 Asia/Karachi can show as 13:00 on a UTC+3 phone.
          const reminderTz = item.timezone || timezone;
          return (
            <AgendaRow
              id={item.id}
              title={item.title}
              notes={item.notes}
              status={item.status}
              timeLabel={formatTimeOnly(
                item.startAt,
                reminderTz,
                prefs.use24HourClock,
              )}
              onPressId={onPressReminder}
            />
          );
        }}
      />

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
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
  header: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm + 2,
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
    marginTop: spacing.sm,
    color: "#1E3A8A",
  },
  agendaRow: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    flexDirection: "row",
    gap: spacing.sm + 4,
    padding: spacing.md - 2,
    borderRadius: radius.md,
    borderCurve: "continuous",
    backgroundColor: "rgba(37, 99, 235, 0.05)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(37, 99, 235, 0.12)",
  },
  agendaRowPressed: {
    backgroundColor: "rgba(37, 99, 235, 0.12)",
  },
  agendaTime: {
    width: 72,
    color: "#1D4ED8",
  },
  agendaBody: {
    flex: 1,
    gap: spacing.xs,
  },
  agendaTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  agendaTitle: {
    flex: 1,
    color: "#0F172A",
  },
  agendaNotes: {
    color: "#64748B",
  },
  emptyText: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm + 4,
    color: "#64748B",
  },
  emptySpinner: {
    marginTop: spacing.lg,
  },
  pressed: {
    opacity: 0.88,
  },
});
