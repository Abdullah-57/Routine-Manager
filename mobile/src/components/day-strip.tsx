import * as Haptics from "expo-haptics";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  getWeekDates,
  shiftDateKey,
  todayDateKey,
} from "@/utils/reminder-time";
import { radius, shadows, spacing } from "@/theme";

const WEEKDAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export type DayStripProps = {
  selectedDate: string; // YYYY-MM-DD
  timezone: string;
  dateCounts?: Record<string, number>;
  onSelectDate: (dateKey: string) => void;
};

export function DayStrip({
  selectedDate,
  timezone,
  dateCounts = {},
  onSelectDate,
}: DayStripProps) {
  const today = todayDateKey(timezone);

  // 7 dates of the current week containing selectedDate
  const weekDates = useMemo(() => {
    return getWeekDates(selectedDate);
  }, [selectedDate]);

  function handleSelect(dateKey: string) {
    if (dateKey !== selectedDate) {
      void Haptics.selectionAsync();
      onSelectDate(dateKey);
    }
  }

  function handlePrevWeek() {
    void Haptics.selectionAsync();
    onSelectDate(shiftDateKey(selectedDate, -7));
  }

  function handleNextWeek() {
    void Haptics.selectionAsync();
    onSelectDate(shiftDateKey(selectedDate, 7));
  }

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Previous week"
        hitSlop={8}
        onPress={handlePrevWeek}
        style={({ pressed }) => [
          styles.weekNavBtn,
          pressed ? styles.weekNavBtnPressed : null,
        ]}
      >
        <Text style={styles.weekNavText}>‹</Text>
      </Pressable>

      <View style={styles.daysRow}>
        {weekDates.map((dateKey, index) => {
          const isSelected = dateKey === selectedDate;
          const isToday = dateKey === today;
          const dayNumber = Number(dateKey.split("-")[2] || "1");
          const weekday = WEEKDAY_NAMES[index] || "";
          const count = dateCounts[dateKey] || 0;

          return (
            <Pressable
              key={dateKey}
              accessibilityRole="button"
              accessibilityLabel={`${weekday} ${dayNumber}${count > 0 ? `, ${count} events` : ""}`}
              onPress={() => handleSelect(dateKey)}
              style={({ pressed }) => [
                styles.dayChip,
                isSelected ? styles.dayChipSelected : null,
                isToday && !isSelected ? styles.dayChipToday : null,
                pressed && !isSelected ? styles.dayChipPressed : null,
              ]}
            >
              <Text
                style={[
                  styles.weekdayLabel,
                  isSelected ? styles.weekdayLabelSelected : null,
                  isToday && !isSelected ? styles.weekdayLabelToday : null,
                ]}
              >
                {weekday}
              </Text>

              <View
                style={[
                  styles.dayCircle,
                  isSelected ? styles.dayCircleSelected : null,
                  isToday && !isSelected ? styles.dayCircleToday : null,
                ]}
              >
                <Text
                  style={[
                    styles.dayNumber,
                    isSelected ? styles.dayNumberSelected : null,
                    isToday && !isSelected ? styles.dayNumberToday : null,
                  ]}
                >
                  {dayNumber}
                </Text>
              </View>

              {/* Event count indicator */}
              <View style={styles.indicatorSlot}>
                {count > 1 ? (
                  <View
                    style={[
                      styles.countPill,
                      isSelected ? styles.countPillSelected : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.countPillText,
                        isSelected ? styles.countPillTextSelected : null,
                      ]}
                    >
                      {count > 9 ? "9+" : count}
                    </Text>
                  </View>
                ) : count === 1 ? (
                  <View
                    style={[
                      styles.dot,
                      isSelected ? styles.dotSelected : null,
                      isToday && !isSelected ? styles.dotToday : null,
                    ]}
                  />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Next week"
        hitSlop={8}
        onPress={handleNextWeek}
        style={({ pressed }) => [
          styles.weekNavBtn,
          pressed ? styles.weekNavBtnPressed : null,
        ]}
      >
        <Text style={styles.weekNavText}>›</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(37, 99, 235, 0.12)",
    boxShadow: shadows.subtle,
  },
  weekNavBtn: {
    width: 28,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
  },
  weekNavBtnPressed: {
    backgroundColor: "rgba(37, 99, 235, 0.08)",
  },
  weekNavText: {
    fontSize: 22,
    fontWeight: "600",
    color: "#2563EB",
    lineHeight: 24,
  },
  daysRow: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  dayChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 4,
    borderRadius: radius.md,
    gap: 3,
  },
  dayChipSelected: {
    backgroundColor: "rgba(37, 99, 235, 0.08)",
  },
  dayChipToday: {
    backgroundColor: "rgba(37, 99, 235, 0.03)",
  },
  dayChipPressed: {
    opacity: 0.7,
  },
  weekdayLabel: {
    fontSize: 10,
    fontWeight: "600",
    color: "#64748B",
    letterSpacing: 0.2,
  },
  weekdayLabelSelected: {
    color: "#1D4ED8",
    fontWeight: "700",
  },
  weekdayLabelToday: {
    color: "#2563EB",
    fontWeight: "700",
  },
  dayCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  dayCircleSelected: {
    backgroundColor: "#1D4ED8",
    boxShadow: shadows.subtle,
  },
  dayCircleToday: {
    borderWidth: 1.5,
    borderColor: "#2563EB",
  },
  dayNumber: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0F172A",
  },
  dayNumberSelected: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  dayNumberToday: {
    color: "#2563EB",
    fontWeight: "700",
  },
  indicatorSlot: {
    height: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#2563EB",
  },
  dotSelected: {
    backgroundColor: "#1D4ED8",
  },
  dotToday: {
    backgroundColor: "#2563EB",
  },
  countPill: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: radius.full,
    backgroundColor: "rgba(37, 99, 235, 0.15)",
  },
  countPillSelected: {
    backgroundColor: "#1D4ED8",
  },
  countPillText: {
    fontSize: 8,
    fontWeight: "700",
    color: "#1D4ED8",
    lineHeight: 10,
  },
  countPillTextSelected: {
    color: "#FFFFFF",
  },
});
