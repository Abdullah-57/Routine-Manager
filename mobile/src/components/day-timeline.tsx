import { useEffect, useMemo, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { ReminderSummary } from "@/api/reminders";
import { ThemedText } from "@/components/ui/themed-text";
import {
  formatTimeOnly,
  getHourAndMinuteInTimezone,
  todayDateKey,
} from "@/utils/reminder-time";
import { radius, shadows, spacing } from "@/theme";

export const HOUR_HEIGHT = 64;
const GUTTER_WIDTH = 54;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export type PositionedTimelineEvent = {
  reminder: ReminderSummary;
  top: number;
  height: number;
  startMinutes: number;
  endMinutes: number;
  colIndex: number;
  totalCols: number;
};

/**
 * Computes Google Calendar-style interval layout:
 * 1. Separates all-day vs timed events.
 * 2. Computes top & height proportional to duration (min 28px).
 * 3. Clusters overlapping events.
 * 4. Greedily allocates side-by-side columns within each cluster.
 */
export function computeTimelineLayout(
  reminders: ReminderSummary[],
  timezone: string,
  hourHeight: number,
): { timed: PositionedTimelineEvent[]; allDay: ReminderSummary[] } {
  const timed: PositionedTimelineEvent[] = [];
  const allDay: ReminderSummary[] = [];

  const parsedEvents: Array<{
    reminder: ReminderSummary;
    startMinutes: number;
    endMinutes: number;
    top: number;
    height: number;
  }> = [];

  for (const item of reminders) {
    const itemTz = item.timezone || timezone;
    const parts = getHourAndMinuteInTimezone(item.startAt, itemTz);

    const startMinutes = parts.hour * 60 + parts.minute;
    let endMinutes = startMinutes + 30; // default 30-min block if no endAt

    if (item.endAt) {
      const endParts = getHourAndMinuteInTimezone(item.endAt, itemTz);
      const calcEnd = endParts.hour * 60 + endParts.minute;
      if (calcEnd > startMinutes) {
        endMinutes = calcEnd;
      } else if (new Date(item.endAt).getTime() > new Date(item.startAt).getTime()) {
        endMinutes = 24 * 60;
      }
    }

    // Full day spanning (00:00 to 24:00 or >= 23h) or explicit tag -> All day
    const isDurationAllDay =
      (startMinutes === 0 && endMinutes >= 1380) ||
      (endMinutes - startMinutes >= 1380);
    const isExplicitAllDay =
      Boolean(item.notes?.toLowerCase().includes("#allday")) ||
      Boolean(item.title?.toLowerCase().includes("[all day]"));

    if (isDurationAllDay || isExplicitAllDay) {
      allDay.push(item);
      continue;
    }

    const clampedEndMinutes = Math.min(1440, endMinutes);
    const duration = Math.max(25, clampedEndMinutes - startMinutes);
    const top = (startMinutes / 60) * hourHeight;
    const height = Math.max(34, (duration / 60) * hourHeight);

    parsedEvents.push({
      reminder: item,
      startMinutes,
      endMinutes: startMinutes + duration,
      top,
      height,
    });
  }

  // Sort by startMinutes asc, then duration desc
  parsedEvents.sort((a, b) => {
    if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
    return b.endMinutes - b.startMinutes - (a.endMinutes - a.startMinutes);
  });

  // Cluster overlapping events
  const clusters: Array<typeof parsedEvents> = [];
  let currentCluster: typeof parsedEvents = [];
  let clusterEnd = -1;

  for (const ev of parsedEvents) {
    if (currentCluster.length === 0) {
      currentCluster.push(ev);
      clusterEnd = ev.endMinutes;
    } else if (ev.startMinutes < clusterEnd) {
      currentCluster.push(ev);
      clusterEnd = Math.max(clusterEnd, ev.endMinutes);
    } else {
      clusters.push(currentCluster);
      currentCluster = [ev];
      clusterEnd = ev.endMinutes;
    }
  }
  if (currentCluster.length > 0) {
    clusters.push(currentCluster);
  }

  // Assign columns within each cluster (greedy graph coloring)
  for (const cluster of clusters) {
    const colEndTimes: number[] = [];
    const clusterEvents: Array<{ ev: (typeof parsedEvents)[0]; col: number }> = [];

    for (const ev of cluster) {
      let placedCol = -1;
      for (let c = 0; c < colEndTimes.length; c++) {
        if (colEndTimes[c] <= ev.startMinutes) {
          placedCol = c;
          colEndTimes[c] = ev.endMinutes;
          break;
        }
      }
      if (placedCol === -1) {
        placedCol = colEndTimes.length;
        colEndTimes.push(ev.endMinutes);
      }
      clusterEvents.push({ ev, col: placedCol });
    }

    const totalCols = Math.max(1, colEndTimes.length);
    for (const { ev, col } of clusterEvents) {
      timed.push({
        reminder: ev.reminder,
        top: ev.top,
        height: ev.height,
        startMinutes: ev.startMinutes,
        endMinutes: ev.endMinutes,
        colIndex: col,
        totalCols,
      });
    }
  }

  return { timed, allDay };
}

function formatHourLabel(hour: number, use24HourClock: boolean): string {
  if (use24HourClock) {
    return `${String(hour).padStart(2, "0")}:00`;
  }
  if (hour === 0) return "12 AM";
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return "12 PM";
  return `${hour - 12} PM`;
}

export type DayTimelineProps = {
  dateKey: string;
  reminders: ReminderSummary[];
  timezone: string;
  use24HourClock: boolean;
  onPressReminder: (id: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
};

export function DayTimeline({
  dateKey,
  reminders,
  timezone,
  use24HourClock,
  onPressReminder,
  onRefresh,
  refreshing = false,
}: DayTimelineProps) {
  const scrollRef = useRef<React.ElementRef<typeof ScrollView> | null>(null);
  const [currentMinutes, setCurrentMinutes] = useState(() => {
    const { hour, minute } = getHourAndMinuteInTimezone(new Date(), timezone);
    return hour * 60 + minute;
  });

  const isToday = dateKey === todayDateKey(timezone);

  // Update current time indicator every 30 seconds
  useEffect(() => {
    if (!isToday) return;
    const interval = setInterval(() => {
      const { hour, minute } = getHourAndMinuteInTimezone(new Date(), timezone);
      setCurrentMinutes(hour * 60 + minute);
    }, 30000);
    return () => clearInterval(interval);
  }, [isToday, timezone]);

  const { timed, allDay } = useMemo(() => {
    return computeTimelineLayout(reminders, timezone, HOUR_HEIGHT);
  }, [reminders, timezone]);

  // Auto-scroll to red "now" line on open (or 8:00 AM / first event)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (isToday) {
        const nowTop = (currentMinutes / 60) * HOUR_HEIGHT;
        scrollRef.current?.scrollTo({
          y: Math.max(0, nowTop - 140),
          animated: true,
        });
      } else if (timed.length > 0) {
        scrollRef.current?.scrollTo({
          y: Math.max(0, timed[0].top - 80),
          animated: true,
        });
      } else {
        // Default to morning 8:00 AM for empty future/past days
        scrollRef.current?.scrollTo({
          y: 8 * HOUR_HEIGHT - 60,
          animated: true,
        });
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [dateKey, isToday]);

  const nowTop = (currentMinutes / 60) * HOUR_HEIGHT;

  return (
    <View style={styles.root}>
      {/* All-Day Strip at the top */}
      {allDay.length > 0 ? (
        <View style={styles.allDayContainer}>
          <View style={styles.allDayGutter}>
            <Text style={styles.allDayGutterText}>ALL DAY</Text>
          </View>
          <View style={styles.allDayContent}>
            {allDay.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={() => onPressReminder(item.id)}
                style={({ pressed }) => [
                  styles.allDayChip,
                  item.kind === "meeting" || item.action?.meetLink
                    ? styles.eventMeeting
                    : item.kind === "call"
                      ? styles.eventCall
                      : styles.eventSimple,
                  pressed ? styles.eventPressed : null,
                ]}
              >
                <Text style={styles.allDayIcon}>
                  {item.kind === "meeting" || item.action?.meetLink
                    ? "🎥"
                    : item.kind === "call"
                      ? "📞"
                      : "⏰"}
                </Text>
                <Text style={styles.allDayTitle} numberOfLines={1}>
                  {item.title}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {/* 24-Hour Scrollable Grid Timeline */}
      <ScrollView
        ref={scrollRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#1D4ED8"
              colors={["#2563EB"]}
            />
          ) : undefined
        }
      >
        <View style={styles.timelineBody}>
          {/* Left Hour Gutter */}
          <View style={styles.gutter}>
            {HOURS.map((h) => (
              <View key={h} style={styles.hourLabelSlot}>
                <Text style={styles.hourLabelText}>
                  {formatHourLabel(h, use24HourClock)}
                </Text>
              </View>
            ))}
          </View>

          {/* Grid Area */}
          <View style={styles.gridArea}>
            {/* Horizontal Hour Lines */}
            {HOURS.map((h) => (
              <View key={h} style={styles.hourSlot}>
                {/* Half-hour guide line */}
                <View style={styles.halfHourLine} />
              </View>
            ))}

            {/* Empty notice banner if no events */}
            {timed.length === 0 && allDay.length === 0 ? (
              <View style={styles.emptyDayNotice} pointerEvents="none">
                <Text style={styles.emptyDayNoticeIcon}>🗓️</Text>
                <Text style={styles.emptyDayNoticeText}>No events scheduled</Text>
              </View>
            ) : null}

            {/* Red "Now" Indicator Line */}
            {isToday ? (
              <View
                style={[styles.nowLineContainer, { top: nowTop }]}
                pointerEvents="none"
              >
                <View style={styles.nowDot} />
                <View style={styles.nowLine} />
              </View>
            ) : null}

            {/* Positioned Event Blocks */}
            {timed.map((ev) => {
              const item = ev.reminder;
              const isMeeting =
                item.kind === "meeting" || Boolean(item.action?.meetLink);
              const isCall = item.kind === "call";
              const isCompleted = item.status === "completed";
              const isCancelled = item.status === "cancelled";

              const itemTz = item.timezone || timezone;
              const timeRangeText = `${formatTimeOnly(item.startAt, itemTz, use24HourClock)}${
                item.endAt
                  ? ` – ${formatTimeOnly(item.endAt, itemTz, use24HourClock)}`
                  : ""
              }`;

              const leftPercent = (ev.colIndex / ev.totalCols) * 100;
              const widthPercent = (1 / ev.totalCols) * 100;

              return (
                <View
                  key={item.id}
                  style={[
                    styles.eventWrapper,
                    {
                      top: ev.top,
                      height: ev.height,
                      left: `${leftPercent}%`,
                      width: `${widthPercent}%`,
                    },
                  ]}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${item.title}, ${timeRangeText}`}
                    onPress={() => onPressReminder(item.id)}
                    style={({ pressed }) => [
                      styles.eventCard,
                      isMeeting
                        ? styles.eventMeeting
                        : isCall
                          ? styles.eventCall
                          : item.kind === "custom"
                            ? styles.eventCustom
                            : styles.eventSimple,
                      isCompleted ? styles.eventCompleted : null,
                      isCancelled ? styles.eventCancelled : null,
                      pressed ? styles.eventPressed : null,
                    ]}
                  >
                    {/* Color Accent Stripe */}
                    <View
                      style={[
                        styles.eventStripe,
                        isMeeting
                          ? styles.stripeMeeting
                          : isCall
                            ? styles.stripeCall
                            : item.kind === "custom"
                              ? styles.stripeCustom
                              : styles.stripeSimple,
                      ]}
                    />

                    <View style={styles.eventInner}>
                      {/* Title Row */}
                      <View style={styles.eventTitleRow}>
                        <Text style={styles.eventIcon}>
                          {isMeeting ? "🎥" : isCall ? "📞" : "⏰"}
                        </Text>
                        <ThemedText
                          variant="caption"
                          style={[
                            styles.eventTitle,
                            isMeeting
                              ? styles.titleMeeting
                              : isCall
                                ? styles.titleCall
                                : styles.titleSimple,
                            isCompleted ? styles.titleCompleted : null,
                            isCancelled ? styles.titleCancelled : null,
                          ]}
                          numberOfLines={1}
                        >
                          {item.title}
                        </ThemedText>
                        {isMeeting ? (
                          <View style={styles.meetPill}>
                            <Text style={styles.meetPillText}>Meet</Text>
                          </View>
                        ) : null}
                        {isCompleted ? (
                          <Text style={styles.completedCheck}>✓</Text>
                        ) : null}
                      </View>

                      {/* Time Label (shown if block is tall enough) */}
                      {ev.height >= 40 ? (
                        <Text
                          style={[
                            styles.eventTimeText,
                            isMeeting
                              ? styles.timeMeeting
                              : isCall
                                ? styles.timeCall
                                : styles.timeSimple,
                          ]}
                          numberOfLines={1}
                        >
                          {timeRangeText}
                        </Text>
                      ) : null}

                      {/* Notes snippet if tall block */}
                      {ev.height >= 68 && item.notes?.trim() ? (
                        <Text style={styles.eventNotesText} numberOfLines={1}>
                          {item.notes.trim()}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  allDayContainer: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0, 0, 0, 0.1)",
    backgroundColor: "#F8FAFC",
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
  },
  allDayGutter: {
    width: GUTTER_WIDTH - 6,
    justifyContent: "center",
  },
  allDayGutterText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#64748B",
    letterSpacing: 0.3,
  },
  allDayContent: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  allDayChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  allDayIcon: {
    fontSize: 12,
  },
  allDayTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "#0F172A",
    maxWidth: 160,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xxl,
  },
  timelineBody: {
    flexDirection: "row",
    height: 24 * HOUR_HEIGHT,
  },
  gutter: {
    width: GUTTER_WIDTH,
  },
  hourLabelSlot: {
    height: HOUR_HEIGHT,
    paddingRight: 6,
    alignItems: "flex-end",
    transform: [{ translateY: -8 }],
  },
  hourLabelText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#94A3B8",
    fontVariant: ["tabular-nums"],
  },
  gridArea: {
    flex: 1,
    position: "relative",
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: "rgba(0, 0, 0, 0.08)",
  },
  hourSlot: {
    height: HOUR_HEIGHT,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0, 0, 0, 0.08)",
    position: "relative",
  },
  halfHourLine: {
    position: "absolute",
    top: HOUR_HEIGHT / 2,
    left: 0,
    right: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(0, 0, 0, 0.03)",
  },
  nowLineContainer: {
    position: "absolute",
    left: -GUTTER_WIDTH,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    zIndex: 20,
    transform: [{ translateY: -4 }],
  },
  nowDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#EF4444",
    marginLeft: GUTTER_WIDTH - 4,
  },
  nowLine: {
    flex: 1,
    height: 2,
    backgroundColor: "#EF4444",
  },
  eventWrapper: {
    position: "absolute",
    paddingRight: 4,
    zIndex: 10,
  },
  eventCard: {
    flex: 1,
    flexDirection: "row",
    borderRadius: radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    overflow: "hidden",
    boxShadow: shadows.subtle,
  },
  eventPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.99 }],
  },
  eventStripe: {
    width: 3.5,
  },
  eventInner: {
    flex: 1,
    paddingHorizontal: 6,
    paddingVertical: 3,
    justifyContent: "center",
    gap: 1,
  },
  eventTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  eventIcon: {
    fontSize: 12,
  },
  eventTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
  },
  completedCheck: {
    fontSize: 11,
    fontWeight: "800",
    color: "#16A34A",
  },
  eventTimeText: {
    fontSize: 10,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  eventNotesText: {
    fontSize: 10,
    color: "#64748B",
  },
  // Meeting theme
  eventMeeting: {
    backgroundColor: "#EFF6FF",
    borderColor: "rgba(59, 130, 246, 0.4)",
  },
  stripeMeeting: {
    backgroundColor: "#2563EB",
  },
  titleMeeting: {
    color: "#1E3A8A",
  },
  timeMeeting: {
    color: "#2563EB",
  },
  // Call theme
  eventCall: {
    backgroundColor: "#F5F3FF",
    borderColor: "rgba(139, 92, 246, 0.4)",
  },
  stripeCall: {
    backgroundColor: "#7C3AED",
  },
  titleCall: {
    color: "#4C1D95",
  },
  timeCall: {
    color: "#6D28D9",
  },
  // Simple / Routine theme
  eventSimple: {
    backgroundColor: "#F0FDF4",
    borderColor: "rgba(16, 185, 129, 0.4)",
  },
  stripeSimple: {
    backgroundColor: "#059669",
  },
  titleSimple: {
    color: "#064E3B",
  },
  timeSimple: {
    color: "#047857",
  },
  // Custom theme
  eventCustom: {
    backgroundColor: "#FFFBEB",
    borderColor: "rgba(245, 158, 11, 0.4)",
  },
  stripeCustom: {
    backgroundColor: "#D97706",
  },
  // Status states
  eventCompleted: {
    opacity: 0.72,
  },
  titleCompleted: {
    textDecorationLine: "line-through",
    color: "#64748B",
  },
  eventCancelled: {
    opacity: 0.45,
  },
  titleCancelled: {
    textDecorationLine: "line-through",
    color: "#94A3B8",
  },
  meetPill: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: "#DBEAFE",
  },
  meetPillText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#1D4ED8",
  },
  emptyDayNotice: {
    position: "absolute",
    top: 18,
    left: 20,
    right: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    backgroundColor: "rgba(241, 245, 249, 0.8)",
    borderWidth: 1,
    borderColor: "rgba(203, 213, 225, 0.6)",
    zIndex: 5,
  },
  emptyDayNoticeIcon: {
    fontSize: 14,
  },
  emptyDayNoticeText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
  },
});
