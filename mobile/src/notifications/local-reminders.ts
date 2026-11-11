import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

const MAP_KEY = "reminderLocalNotificationIds.v1";
const PERMISSION_ASKED_KEY = "notificationPermissionAsked.v1";
const EXACT_ALARM_ASKED_KEY = "exactAlarmPermissionAsked.v1";
export const REMINDERS_CHANNEL_ID = "reminders";

type ReminderLike = {
  id: string;
  title: string;
  notes?: string | null;
  startAt: string;
  status: string;
};

type IdMap = Record<string, string>;

async function loadMap(): Promise<IdMap> {
  try {
    const raw = await AsyncStorage.getItem(MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as IdMap;
  } catch {
    return {};
  }
}

async function saveMap(map: IdMap) {
  await AsyncStorage.setItem(MAP_KEY, JSON.stringify(map));
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

export async function cancelReminderLocalNotification(reminderId: string) {
  if (Platform.OS === "web") return;

  try {
    const map = await loadMap();
    const existing = map[reminderId];
    if (existing) {
      try {
        await Notifications.cancelScheduledNotificationAsync(existing);
      } catch {
        // Already fired or missing — ignore
      }
      delete map[reminderId];
      await saveMap(map);
    }
  } catch (error) {
    if (__DEV__) {
      console.warn("cancelReminderLocalNotification failed:", error);
    }
  }
}

/**
 * Schedule (or replace) a one-shot local notification at reminder.startAt.
 * Skips past times and non-scheduled statuses.
 */
export async function scheduleReminderLocalNotification(
  reminder: ReminderLike,
): Promise<string | null> {
  if (Platform.OS === "web") return null;

  try {
    await cancelReminderLocalNotification(reminder.id);

    if (reminder.status !== "scheduled") {
      return null;
    }

    const when = new Date(reminder.startAt);
    const msUntil = when.getTime() - Date.now();
    if (Number.isNaN(when.getTime()) || msUntil <= 1500) {
      if (__DEV__) {
        console.warn(
          "Skipping local notification (past or invalid startAt):",
          reminder.id,
          reminder.startAt,
        );
      }
      return null;
    }

    const allowed = await requestNotificationPermission();
    if (!allowed) {
      if (__DEV__) {
        console.warn(
          "Skipping local notification — notification permission not granted:",
          reminder.id,
        );
      }
      return null;
    }

    await ensureAndroidRemindersChannel();

    // Deep link so taps can reopen the app into this reminder.
    const path = `reminder/${reminder.id}`;
    const deepLink = Linking.createURL(path);

    // Near-term: TIME_INTERVAL is often more reliable than DATE on Android.
    // Longer-term: DATE + alarmClock for wall-clock delivery.
    const useInterval = msUntil <= 60 * 60 * 1000; // within 1 hour
    const androidChannel =
      Platform.OS === "android" ? { channelId: REMINDERS_CHANNEL_ID } : {};

    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title: reminder.title || "Reminder",
        body: reminder.notes?.trim()
          ? reminder.notes.trim()
          : "It's time for this routine item.",
        data: {
          reminderId: reminder.id,
          screen: "reminder",
          url: `/reminder/${reminder.id}`,
          deepLink,
        },
        sound: true,
        ...androidChannel,
      },
      trigger: useInterval
        ? {
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds: Math.max(2, Math.ceil(msUntil / 1000)),
            ...androidChannel,
          }
        : {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: when,
            delivery: "alarmClock",
            ...androidChannel,
          },
    });

    if (__DEV__) {
      console.log(
        "Scheduled local notification",
        identifier,
        "for",
        reminder.id,
        "at",
        when.toISOString(),
        useInterval ? `(in ${Math.ceil(msUntil / 1000)}s)` : "(date)",
      );
    }

    const map = await loadMap();
    map[reminder.id] = identifier;
    await saveMap(map);
    return identifier;
  } catch (error) {
    if (__DEV__) {
      console.warn("scheduleReminderLocalNotification failed:", error);
    }
    return null;
  }
}

/** Cancel + reschedule after an edit. */
export async function rescheduleReminderLocalNotification(
  reminder: ReminderLike,
) {
  return scheduleReminderLocalNotification(reminder);
}

/**
 * Keep local schedules aligned with the server list without thrashing:
 * - cancel orphans / past / non-scheduled
 * - schedule missing future scheduled reminders
 */
export async function syncLocalNotificationsForReminders(
  reminders: ReminderLike[],
) {
  if (Platform.OS === "web") return;

  try {
    const map = await loadMap();
    const now = Date.now() + 1500;
    const keep = new Set<string>();

    for (const reminder of reminders) {
      const startMs = new Date(reminder.startAt).getTime();
      const eligible =
        reminder.status === "scheduled" &&
        Number.isFinite(startMs) &&
        startMs > now;
      if (eligible) keep.add(reminder.id);
    }

    for (const reminderId of Object.keys(map)) {
      if (!keep.has(reminderId)) {
        await cancelReminderLocalNotification(reminderId);
      }
    }

    const freshMap = await loadMap();
    for (const reminder of reminders) {
      if (!keep.has(reminder.id)) continue;
      if (freshMap[reminder.id]) continue;
      await scheduleReminderLocalNotification(reminder);
    }
  } catch (error) {
    if (__DEV__) {
      console.warn("syncLocalNotificationsForReminders failed:", error);
    }
  }
}
