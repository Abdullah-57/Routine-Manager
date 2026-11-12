import { SymbolView } from "expo-symbols";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, shadows, spacing } from "@/theme";

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

function NavChevron({ direction }: { direction: "left" | "right" }) {
  if (process.env.EXPO_OS === "ios") {
    return (
      <SymbolView
        name={direction === "left" ? "chevron.left" : "chevron.right"}
        size={14}
        tintColor={colors.tint}
        weight="semibold"
      />
    );
  }
  return (
    <Text style={styles.navFallback}>{direction === "left" ? "‹" : "›"}</Text>
  );
}

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
          hitSlop={8}
          onPress={() => {
            const next = shiftMonth(year, month, -1);
            onChangeMonth(next.year, next.month);
          }}
          style={({ pressed }) => [
            styles.navButton,
            pressed ? styles.pressed : null,
          ]}
        >
          <NavChevron direction="left" />
        </Pressable>
        <Text style={styles.title}>{title}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          hitSlop={8}
          onPress={() => {
            const next = shiftMonth(year, month, 1);
            onChangeMonth(next.year, next.month);
          }}
          style={({ pressed }) => [
            styles.navButton,
            pressed ? styles.pressed : null,
          ]}
        >
          <NavChevron direction="right" />
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
                pressed && !selected ? styles.cellPressed : null,
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
              {marked ? (
                <View
                  style={[styles.dot, selected ? styles.dotSelected : null]}
                />
              ) : (
                <View style={styles.dotPlaceholder} />
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.lg,
    borderCurve: "continuous",
    padding: spacing.md - 4,
    backgroundColor: colors.secondaryGroupedBackground,
    gap: spacing.sm,
    boxShadow: shadows.subtle,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.label,
  },
  navButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.fill,
  },
  navFallback: {
    fontSize: 22,
    color: colors.tint,
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
    color: colors.tertiaryLabel,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cell: {
    width: "14.2857%",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderCurve: "continuous",
    gap: spacing.xs,
  },
  cellSelected: {
    backgroundColor: colors.tint,
  },
  cellPressed: {
    backgroundColor: colors.fill,
  },
  dayLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.label,
  },
  dayLabelSelected: {
    color: colors.onTint,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.tint,
  },
  dotSelected: {
    backgroundColor: colors.onTint,
  },
  dotPlaceholder: {
    width: 5,
    height: 5,
  },
  pressed: {
    opacity: 0.75,
  },
});
