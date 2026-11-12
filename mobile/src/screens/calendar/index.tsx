import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { ApiError } from "@/api/client";
import { listReminders, type ReminderSummary } from "@/api/reminders";
import { useAuth } from "@/auth/AuthContext";
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
import { colors, radius, shadows, spacing } from "@/theme";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "refreshing" }
  | { status: "error"; message: string };

function getDeviceTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
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
          <ThemedText variant="caption" numberOfLines={2}>
            {notes}
          </ThemedText>
        ) : null}
      </View>
    </Pressable>
  );
}

export function CalendarScreen() {
  const { user, token } = useAuth();
  const { push } = useRouter();
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

  const listHeader = (
    <View style={styles.header}>
      <ThemedText variant="largeTitle">Calendar</ThemedText>
      <ThemedText variant="subhead">
        In-app agenda (not your phone OS calendar). Dots mark days with
        reminders.
      </ThemedText>
      <ThemedText variant="caption">Timezone: {timezone}</ThemedText>

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
    <FlatList
      data={dayReminders}
      keyExtractor={(item) => item.id}
      style={styles.list}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.listContent}
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
          tintColor={colors.tint}
          colors={[colors.seed]}
        />
      }
      ListEmptyComponent={
        load.status === "loading" ? (
          <ActivityIndicator color={colors.tint} style={styles.emptySpinner} />
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
            timeLabel={formatTimeOnly(item.startAt, reminderTz)}
            onPressId={onPressReminder}
          />
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: colors.groupedBackground,
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.sm + 2,
  },
  sectionTitle: {
    marginTop: spacing.sm,
  },
  agendaRow: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    flexDirection: "row",
    gap: spacing.sm + 4,
    padding: spacing.md - 2,
    borderRadius: radius.md,
    borderCurve: "continuous",
    backgroundColor: colors.secondaryGroupedBackground,
    boxShadow: shadows.subtle,
  },
  agendaRowPressed: {
    backgroundColor: colors.fill,
  },
  agendaTime: {
    width: 72,
    color: colors.tint,
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
  },
  emptyText: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm + 4,
  },
  emptySpinner: {
    marginTop: spacing.lg,
  },
});
