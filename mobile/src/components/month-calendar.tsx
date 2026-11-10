import { Pressable, StyleSheet, Text, View } from "react-native";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type MonthCalendarProps = {
  year: number;
  month: number; // 1-12
  selectedDate: string; // YYYY-MM-DD
  markedDates: Record<string, boolean>;
  onSelectDate: (dateKey: string) => void;
  onChangeMonth: (year: number, month: number) => void;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function dateKey(year: number, month: number, day: number) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function shiftMonth(year: number, month: number, delta: number) {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

function buildCells(year: number, month: number) {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: Array<{ key: string; label: string; dateKey?: string }> = [];

  for (let i = 0; i < firstWeekday; i += 1) {
    cells.push({ key: `pad-${i}`, label: "" });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({
      key: `day-${day}`,
      label: String(day),
      dateKey: dateKey(year, month, day),
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push({ key: `trail-${cells.length}`, label: "" });
  }

  return cells;
}

const monthTitleFormatter = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function MonthCalendar({
  year,
  month,
  selectedDate,
  markedDates,
  onSelectDate,
  onChangeMonth,
}: MonthCalendarProps) {
  const cells = buildCells(year, month);
  const title = monthTitleFormatter.format(
    new Date(Date.UTC(year, month - 1, 1)),
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          onPress={() => {
            const next = shiftMonth(year, month, -1);
            onChangeMonth(next.year, next.month);
          }}
          style={({ pressed }) => [
            styles.navButton,
            pressed ? styles.pressed : null,
          ]}
        >
          <Text style={styles.navLabel}>‹</Text>
        </Pressable>
        <Text style={styles.title}>{title}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          onPress={() => {
            const next = shiftMonth(year, month, 1);
            onChangeMonth(next.year, next.month);
          }}
          style={({ pressed }) => [
            styles.navButton,
            pressed ? styles.pressed : null,
          ]}
        >
          <Text style={styles.navLabel}>›</Text>
        </Pressable>
      </View>

      <View style={styles.weekRow}>
        {WEEKDAYS.map((day) => (
          <Text key={day} style={styles.weekday}>
            {day}
          </Text>
        ))}
      </View>

      <View style={styles.grid}>
        {cells.map((cell) => {
          if (!cell.dateKey) {
            return <View key={cell.key} style={styles.cell} />;
          }

          const selected = cell.dateKey === selectedDate;
          const marked = !!markedDates[cell.dateKey];

          return (
            <Pressable
              key={cell.key}
              accessibilityRole="button"
              onPress={() => onSelectDate(cell.dateKey!)}
              style={({ pressed }) => [
                styles.cell,
                selected ? styles.cellSelected : null,
                pressed ? styles.pressed : null,
              ]}
            >
              <Text
                style={[
                  styles.dayLabel,
                  selected ? styles.dayLabelSelected : null,
                ]}
              >
                {cell.label}
              </Text>
              {marked ? <View style={styles.dot} /> : <View style={styles.dotPlaceholder} />}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 12,
    borderCurve: "continuous",
    padding: 12,
    backgroundColor: "#ffffff",
    gap: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: "#171717",
  },
  navButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f5f5f5",
  },
  navLabel: {
    fontSize: 22,
    color: "#2563eb",
    lineHeight: 24,
  },
  weekRow: {
    flexDirection: "row",
  },
  weekday: {
    flex: 1,
    textAlign: "center",
    fontSize: 12,
    fontWeight: "600",
    color: "#737373",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cell: {
    width: "14.2857%",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    borderRadius: 10,
    borderCurve: "continuous",
    gap: 4,
  },
  cellSelected: {
    backgroundColor: "#2563eb",
  },
  dayLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#171717",
  },
  dayLabelSelected: {
    color: "#ffffff",
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#93c5fd",
  },
  dotPlaceholder: {
    width: 6,
    height: 6,
  },
  pressed: {
    opacity: 0.85,
  },
});
