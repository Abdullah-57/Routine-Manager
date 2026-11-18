import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { syncLocallyScheduledTokensWithBackend } from "@/api/reminders";
import { tokenStorage } from "@/auth/token-storage";
import { resolveNotificationCategory, setupNotificationCategories } from "./categories";
import { getCachedPushToken } from "./register-push-token";

const MAP_KEY = "reminderLocalNotificationIds.v1";
const PERMISSION_ASKED_KEY = "notificationPermissionAsked.v1";
const EXACT_ALARM_ASKED_KEY = "exactAlarmPermissionAsked.v1";
export const REMINDERS_CHANNEL_ID = "reminders";

export type ReminderLike = {
  id: string;
  title: string;
  notes?: string | null;
  startAt: string;
  status: string;
  kind?: string | null;
  leadTimes?: number[] | null;
  action?: {
    meetLink?: string | null;
  } | null;
};

type StoredSchedule = {
  ids: string[];
  signature?: string;
};

type StoredMap = Record<string, StoredSchedule>;

async function loadMap(): Promise<StoredMap> {
  try {
    const raw = await AsyncStorage.getItem(MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};

    const normalized: StoredMap = {};
    for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (val && typeof val === "object" && Array.isArray((val as any).ids)) {
        normalized[key] = {
          ids: (val as any).ids.filter((item: unknown): item is string => typeof item === "string"),
          signature: typeof (val as any).signature === "string" ? (val as any).signature : undefined,
        };
      } else if (Array.isArray(val)) {
        normalized[key] = {
          ids: val.filter((item: unknown): item is string => typeof item === "string"),
        };
      } else if (typeof val === "string") {
        normalized[key] = {
          ids: [val],
        };
      }
    }
    return normalized;
  } catch {
    return {};
  }
}

async function saveMap(map: StoredMap) {
  await AsyncStorage.setItem(MAP_KEY, JSON.stringify(map));
}

function reminderSignature(reminder: ReminderLike): string {
  const leadStr = (reminder.leadTimes || [])
    .slice()
    .sort((a, b) => a - b)
    .join(",");
  return `${reminder.id}|${reminder.startAt}|${leadStr}|${reminder.status}|${reminder.title}`;
}

function formatLeadDuration(mins: number): string {
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
  if (mins === 60) return "1 hour";
  if (mins % 1440 === 0) {
    const days = mins / 1440;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (mins % 60 === 0) {
    const hours = mins / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

/**
 * Android 8+ needs a channel. Keep options minimal — some Expo Go / device
 * builds NPE on vibrationPattern or a null importance enum value.
 *
 * Android 13+ also will not show the notification permission prompt until
 * at least one channel exists.
 */
export async function ensureAndroidRemindersChannel() {
  if (Platform.OS !== "android") return;

  const importance =
    Notifications.AndroidImportance?.MAX ??
    Notifications.AndroidImportance?.HIGH ??
    Notifications.AndroidImportance?.DEFAULT ??
    5;

  try {
    await setupNotificationCategories();
    await Notifications.setNotificationChannelAsync(REMINDERS_CHANNEL_ID, {
      name: "Reminders",
      importance,
      bypassDnd: false,
      enableVibrate: true,
    });
  } catch (error) {
    // Non-fatal: scheduling may still work with the default channel.
    if (__DEV__) {
      console.warn("Could not create reminders notification channel:", error);
    }
  }
}

/**
 * Android 12+ needs "Alarms & reminders" (exact alarm) for on-time DATE
 * triggers. Without it, the OS may delay or drop the alert.
 */
export async function ensureExactAlarmPermission(): Promise<boolean> {
  if (Platform.OS !== "android") return true;

  try {
    const current = await Notifications.getExactAlarmPermissionsAsync();
    if (current.granted) return true;

    const asked = await AsyncStorage.getItem(EXACT_ALARM_ASKED_KEY);
    if (asked === "1" && !current.canAskAgain) {
      return false;
    }

    // Opens the system "Alarms & reminders" screen on Android 14+.
    const next = await Notifications.requestExactAlarmPermissionsAsync();
    await AsyncStorage.setItem(EXACT_ALARM_ASKED_KEY, "1");
    return next.granted;
  } catch (error) {
    // Older builds without SCHEDULE_EXACT_ALARM in the manifest reject this.
    if (__DEV__) {
      console.warn("Exact alarm permission request failed:", error);
    }
    return false;
  }
}

/** Returns true if notifications are allowed. Never throws. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;

  try {
    await ensureAndroidRemindersChannel();

    const current = await Notifications.getPermissionsAsync();
    let granted = current.granted;

    if (!granted) {
      const asked = await AsyncStorage.getItem(PERMISSION_ASKED_KEY);
      if (asked === "1" && current.status === "denied") {
        return false;
      }

      const next = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
        },
      });
      await AsyncStorage.setItem(PERMISSION_ASKED_KEY, "1");
      granted = next.granted;
    }

    if (granted) {
      // Best-effort: exact alarms make 2–3 minute reminders fire on time.
      await ensureExactAlarmPermission();
    }

    return granted;
  } catch (error) {
    if (__DEV__) {
      console.warn("Notification permission request failed:", error);
    }
    return false;
  }
}

let schedulingLock = Promise.resolve();

function withSchedulingLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = schedulingLock.then(fn, fn);
  schedulingLock = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function cancelReminderLocalNotificationInternal(reminderId: string) {
  if (Platform.OS === "web") return;

  try {
    const map = await loadMap();
    const existing = map[reminderId];
    if (existing && existing.ids.length > 0) {
      for (const notifId of existing.ids) {
        try {
          await Notifications.cancelScheduledNotificationAsync(notifId);
        } catch {
          // Already fired or missing — ignore
        }
      }
      delete map[reminderId];
      await saveMap(map);
    }

    // Safety net: inspect OS-level scheduled notifications for this reminderId
    // to guarantee no zombie or duplicate notifications survive in the OS alarm manager.
    const allScheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const notif of allScheduled) {
      const data = notif.content?.data as Record<string, unknown> | undefined;
      if (data && data.reminderId === reminderId) {
        try {
          await Notifications.cancelScheduledNotificationAsync(notif.identifier);
        } catch {
          // Ignore
        }
      }
    }
  } catch (error) {
    if (__DEV__) {
      console.warn("cancelReminderLocalNotification failed:", error);
    }
  }
}

export async function cancelReminderLocalNotification(reminderId: string) {
  return withSchedulingLock(() => cancelReminderLocalNotificationInternal(reminderId));
}

/**
 * Schedule N+1 local notifications per reminder:
 * 1) Pre-reminder alerts for each configured lead time (e.g. 5m, 15m, 60m before startAt)
 * 2) Main reminder alert at startAt
 *
 * All notifications include deep links and `reminderId` so tapping any of them
 * immediately routes to the Edit Reminder screen.
 */
async function scheduleReminderLocalNotificationInternal(
  reminder: ReminderLike,
): Promise<string[]> {
  if (Platform.OS === "web") return [];

  try {
    await cancelReminderLocalNotificationInternal(reminder.id);

    if (reminder.status !== "scheduled") {
      return [];
    }

    const when = new Date(reminder.startAt);
    const startMs = when.getTime();
    if (Number.isNaN(startMs)) {
      if (__DEV__) {
        console.warn(
          "Skipping local notification (invalid startAt):",
          reminder.id,
          reminder.startAt,
        );
      }
      return [];
    }

    const allowed = await requestNotificationPermission();
    if (!allowed) {
      if (__DEV__) {
        console.warn(
          "Skipping local notification — notification permission not granted:",
          reminder.id,
        );
      }
      return [];
    }

    await ensureAndroidRemindersChannel();

    const kind = reminder.kind || "simple";
    const meetLink = reminder.action?.meetLink ?? null;
    const isMeeting = kind === "meeting" || Boolean(meetLink);

    // Deep link so taps reopen the app into pre-meeting screen for meetings, or reminder detail for simple reminders.
    const path = isMeeting
      ? `reminder/${reminder.id}?action=join`
      : `reminder/${reminder.id}`;
    const deepLink = Linking.createURL(path);
    const androidChannel =
      Platform.OS === "android" ? { channelId: REMINDERS_CHANNEL_ID } : {};

    const categoryIdentifier = resolveNotificationCategory(kind);
    const joinUrl = meetLink;

    const scheduledIds: string[] = [];
    const now = Date.now();

    // 1. Schedule Pre-Reminders (Lead Times)
    const leadTimes = Array.from(
      new Set(
        (reminder.leadTimes || []).filter(
          (m): m is number => typeof m === "number" && m > 0,
        ),
      ),
    ).sort((a, b) => b - a);

    for (const mins of leadTimes) {
      const preWhen = new Date(startMs - mins * 60 * 1000);
      const msUntilPre = preWhen.getTime() - now;

      // Skip pre-alerts that are already in the past
      if (msUntilPre <= 1500) {
        continue;
      }

      const durationText = formatLeadDuration(mins);
      let preBody = `Heads-up: ${reminder.title || "Reminder"} starts in ${durationText}.`;
      if (reminder.notes?.trim()) {
        preBody += `\n${reminder.notes.trim()}`;
      }

      const useIntervalPre = msUntilPre <= 60 * 60 * 1000;
      const preIdentifier = await Notifications.scheduleNotificationAsync({
        content: {
          title: reminder.title || "Reminder",
          subtitle: `Heads-up · In ${durationText}`,
          body: preBody,
          categoryIdentifier,
          autoDismiss: true,
          data: {
            reminderId: reminder.id,
            title: reminder.title,
            notes: reminder.notes ?? null,
            kind,
            action: isMeeting ? "join" : undefined,
            screen: "reminder",
            url: isMeeting
              ? `/reminder/${reminder.id}?action=join`
              : `/reminder/${reminder.id}`,
            deepLink,
            joinUrl,
            meetLink,
            isPreAlert: true,
            leadTimeMinutes: mins,
            dispatchId: `${reminder.id}:${mins}`,
          },
          sound: true,
          ...androidChannel,
        },
        trigger: useIntervalPre
          ? {
              type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
              seconds: Math.max(2, Math.ceil(msUntilPre / 1000)),
              repeats: false,
              ...androidChannel,
            }
          : {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date: preWhen,
              delivery: "alarmClock",
              ...androidChannel,
            },
      });

      scheduledIds.push(preIdentifier);

      if (__DEV__) {
        console.log(
          "Scheduled pre-alert notification",
          preIdentifier,
          `(-${mins}m)`,
          "for",
          reminder.id,
          "at",
          preWhen.toISOString(),
          useIntervalPre ? `(in ${Math.ceil(msUntilPre / 1000)}s)` : "(date)",
        );
      }
    }

    // 2. Schedule Main Event Notification at startAt
    const msUntilMain = startMs - now;
    if (msUntilMain > 1500) {
      let mainBody = "";
      if (reminder.kind === "meeting") {
        mainBody = "Your meeting is starting now.";
      } else if (reminder.kind === "call") {
        mainBody = "Your call is starting now.";
      } else {
        mainBody = reminder.notes?.trim() || "It's time for this routine item.";
      }
      if (reminder.notes?.trim() && (reminder.kind === "meeting" || reminder.kind === "call")) {
        mainBody += `\n${reminder.notes.trim()}`;
      }

      const useIntervalMain = msUntilMain <= 60 * 60 * 1000;
      const mainIdentifier = await Notifications.scheduleNotificationAsync({
        content: {
          title: reminder.title || "Reminder",
          subtitle:
            reminder.kind === "meeting"
              ? "Meeting · Starts Now"
              : reminder.kind === "call"
                ? "Call · Starts Now"
                : "Starts Now",
          body: mainBody,
          categoryIdentifier,
          autoDismiss: true,
          data: {
            reminderId: reminder.id,
            title: reminder.title,
            notes: reminder.notes ?? null,
            kind,
            action: isMeeting ? "join" : undefined,
            screen: "reminder",
            url: isMeeting
              ? `/reminder/${reminder.id}?action=join`
              : `/reminder/${reminder.id}`,
            deepLink,
            joinUrl,
            meetLink,
            isPreAlert: false,
            leadTimeMinutes: 0,
            dispatchId: `${reminder.id}:0`,
          },
          sound: true,
          ...androidChannel,
        },
        trigger: useIntervalMain
          ? {
              type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
              seconds: Math.max(2, Math.ceil(msUntilMain / 1000)),
              repeats: false,
              ...androidChannel,
            }
          : {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date: when,
              delivery: "alarmClock",
              ...androidChannel,
            },
      });

      scheduledIds.push(mainIdentifier);

      if (__DEV__) {
        console.log(
          "Scheduled main notification",
          mainIdentifier,
          "for",
          reminder.id,
          "at",
          when.toISOString(),
          useIntervalMain ? `(in ${Math.ceil(msUntilMain / 1000)}s)` : "(date)",
        );
      }
    }

    if (scheduledIds.length > 0) {
      const map = await loadMap();
      map[reminder.id] = {
        ids: scheduledIds,
        signature: reminderSignature(reminder),
      };
      await saveMap(map);
    }

    return scheduledIds;
  } catch (error) {
    if (__DEV__) {
      console.warn("scheduleReminderLocalNotification failed:", error);
    }
    return [];
  }
}

export async function scheduleReminderLocalNotification(
  reminder: ReminderLike,
): Promise<string[]> {
  return withSchedulingLock(() => scheduleReminderLocalNotificationInternal(reminder));
}

/** Cancel + reschedule after an edit. */
export async function rescheduleReminderLocalNotification(
  reminder: ReminderLike,
) {
  return scheduleReminderLocalNotification(reminder);
}

/**
 * Keep local schedules aligned with the server list without thrashing:
 * - cancel orphans / past / non-scheduled (from both map AND device OS alarm manager)
 * - schedule or update missing / changed reminders
 */
async function syncLocalNotificationsForRemindersInternal(
  reminders: ReminderLike[],
) {
  if (Platform.OS === "web") return;

  try {
    const now = Date.now() + 1500;
    const activeScheduledReminderIds = new Set<string>();

    for (const reminder of reminders) {
      const startMs = new Date(reminder.startAt).getTime();
      const eligible =
        reminder.status === "scheduled" &&
        Number.isFinite(startMs) &&
        startMs > now;
      if (eligible) activeScheduledReminderIds.add(reminder.id);
    }

    // 1. HARD CLEANUP: Inspect all actual notifications currently scheduled in the OS!
    // Cancel any notification whose reminder is deleted, cancelled, completed, or no longer eligible.
    const allScheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const notif of allScheduled) {
      const data = notif.content?.data as Record<string, unknown> | undefined;
      if (data && typeof data.reminderId === "string") {
        if (!activeScheduledReminderIds.has(data.reminderId)) {
          try {
            await Notifications.cancelScheduledNotificationAsync(notif.identifier);
            if (__DEV__) {
              console.log("Cancelled orphan OS notification", notif.identifier, "for deleted reminder", data.reminderId);
            }
          } catch {
            // Ignore
          }
        }
      }
    }

    // 2. Clean up AsyncStorage map for reminders no longer eligible
    const map = await loadMap();
    for (const reminderId of Object.keys(map)) {
      if (!activeScheduledReminderIds.has(reminderId)) {
        await cancelReminderLocalNotificationInternal(reminderId);
      }
    }

    // 3. Re-check remaining and ensure fresh notifications match current signature
    const freshMap = await loadMap();
    for (const reminder of reminders) {
      if (!activeScheduledReminderIds.has(reminder.id)) continue;

      const existing = freshMap[reminder.id];
      const sig = reminderSignature(reminder);

      if (existing && existing.ids.length > 0 && existing.signature === sig) {
        continue;
      }

      await scheduleReminderLocalNotificationInternal(reminder);
    }

    // 4. Notify backend of which reminders this physical device has scheduled locally.
    // The server-side scheduler uses this to suppress duplicate remote pushes to this phone!
    void (async () => {
      try {
        const [token, pushToken] = await Promise.all([
          tokenStorage.getToken(),
          getCachedPushToken(),
        ]);
        if (token && pushToken) {
          await syncLocallyScheduledTokensWithBackend(
            token,
            pushToken,
            Array.from(activeScheduledReminderIds),
          );
        }
      } catch {
        // Non-fatal
      }
    })();
  } catch (error) {
    if (__DEV__) {
      console.warn("syncLocalNotificationsForReminders failed:", error);
    }
  }
}

export async function syncLocalNotificationsForReminders(
  reminders: ReminderLike[],
) {
  return withSchedulingLock(() => syncLocalNotificationsForRemindersInternal(reminders));
}
