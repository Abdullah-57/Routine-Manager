import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ApiError } from "@/api/client";
import { listReminders, type ReminderSummary } from "@/api/reminders";
import { useAuth } from "@/auth/AuthContext";
import { MonthCalendar } from "@/components/month-calendar";
import { StatusBadge } from "@/components/status-badge";
import {
  compareRemindersByStartAscending,
  dateKeyInTimezone,
  formatTimeOnly,
  monthRangeISO,
  todayDateKey,
} from "@/utils/reminder-time";

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
      <Text style={styles.agendaTime}>{timeLabel}</Text>
      <View style={styles.agendaBody}>
        <View style={styles.agendaTitleRow}>
          <Text style={styles.agendaTitle}>{title}</Text>
          <StatusBadge status={status} />
        </View>
        {notes ? <Text style={styles.agendaNotes}>{notes}</Text> : null}
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
      // Always bucket by the viewer's timezone so marks match the agenda.
      const key = dateKeyInTimezone(item.startAt, timezone);
      marks[key] = true;
    }
    return marks;
  }, [monthReminders, timezone]);

  const dayReminders = useMemo(() => {
    // Applies to ALL reminders (old and new): earliest startAt at top.
    return monthReminders
      .filter((item) => dateKeyInTimezone(item.startAt, timezone) === selectedDate)
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
      <Text style={styles.title}>Calendar</Text>
      <Text style={styles.subtitle}>
        In-app agenda (not your phone OS calendar). Dots mark days with
        reminders.
      </Text>
      <Text style={styles.meta}>Timezone: {timezone}</Text>

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

      <Text style={styles.sectionTitle}>Agenda · {selectedDate}</Text>

      {load.status === "error" ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorLabel}>Could not refresh</Text>
          <Text style={styles.errorBody}>{load.message}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              void fetchMonth(
                visibleMonth.year,
                visibleMonth.month,
                "refreshing",
              )
            }
          >
            <Text style={styles.retry}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  return (
    <FlatList
      data={dayReminders}
      keyExtractor={(item) => item.id}
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
          tintColor="#2563eb"
        />
      }
      ListEmptyComponent={
        load.status === "loading" ? (
          <ActivityIndicator color="#2563eb" style={styles.emptySpinner} />
        ) : (
          <Text style={styles.emptyText}>
            No reminders on this day. Create some from Home, then pull to
            refresh.
          </Text>
        )
      }
      renderItem={({ item }) => (
        <AgendaRow
          id={item.id}
          title={item.title}
          notes={item.notes}
          status={item.status}
          // Same timezone as sort/filter so on-screen times match list order.
          timeLabel={formatTimeOnly(item.startAt, timezone)}
          onPressId={onPressReminder}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingBottom: 40,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 10,
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
  meta: {
    fontSize: 13,
    color: "#737373",
  },
  sectionTitle: {
    marginTop: 8,
    fontSize: 18,
    fontWeight: "600",
  },
  agendaRow: {
    marginHorizontal: 20,
    marginTop: 8,
    flexDirection: "row",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: "#e5e5e5",
    backgroundColor: "#fafafa",
  },
  agendaRowPressed: {
    opacity: 0.85,
  },
  agendaTime: {
    width: 72,
    fontSize: 14,
    fontWeight: "600",
    color: "#2563eb",
  },
  agendaBody: {
    flex: 1,
    gap: 4,
  },
  agendaTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  agendaTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: "#171717",
  },
  agendaNotes: {
    fontSize: 14,
    color: "#525252",
  },
  emptyText: {
    marginHorizontal: 20,
    marginTop: 12,
    color: "#737373",
    lineHeight: 20,
  },
  emptySpinner: {
    marginTop: 20,
  },
  errorBox: {
    backgroundColor: "#fef2f2",
    borderRadius: 12,
    borderCurve: "continuous",
    padding: 12,
    gap: 4,
  },
  errorLabel: {
    fontWeight: "700",
  },
  errorBody: {
    color: "#404040",
  },
  retry: {
    marginTop: 6,
    color: "#2563eb",
    fontWeight: "600",
  },
});
