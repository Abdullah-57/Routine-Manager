import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import { AppState, BackHandler, Platform, ToastAndroid } from "react-native";
import { acknowledgeReminderDispatch, updateReminder } from "@/api/reminders";
import { tokenStorage } from "@/auth/token-storage";
import {
  NOTIFICATION_ACTIONS,
  NOTIFICATION_CATEGORIES,
  resolveNotificationCategory,
  setupNotificationCategories,
} from "./categories";
import {
  cancelReminderLocalNotification,
  REMINDERS_CHANNEL_ID,
} from "./local-reminders";

const HANDLED_DISPATCHES_KEY = "handledReminderDispatches.v1";
const DEDUPE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes for exact alert matches
const FUZZY_ALERT_WINDOW_MS = 45 * 1000; // 45 seconds: any second alert for same reminderId is a duplicate

/** In-memory cache of exact dispatchId ("<reminderId>:<leadTime>") -> timestamp (ms) */
const handledDispatches = new Map<string, number>();

/** In-memory cache of reminderId -> last alert timestamp (ms) to catch local vs push duplicate races */
const recentReminderAlerts = new Map<string, number>();

// Load persisted handled dispatches and setup notification categories on startup
if (Platform.OS !== "web") {
  void setupNotificationCategories();
  void AsyncStorage.getItem(HANDLED_DISPATCHES_KEY)
    .then((raw) => {
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, number>;
      const cutoff = Date.now() - DEDUPE_WINDOW_MS;
      for (const [id, ts] of Object.entries(parsed)) {
        if (typeof ts === "number" && ts > cutoff) {
          handledDispatches.set(id, ts);
          const colon = id.lastIndexOf(":");
          if (colon > 0) {
            recentReminderAlerts.set(id.slice(0, colon), ts);
          }
        }
      }
    })
    .catch(() => {});
}

async function persistHandledDispatches() {
  try {
    const cutoff = Date.now() - DEDUPE_WINDOW_MS;
    const obj: Record<string, number> = {};
    for (const [id, ts] of handledDispatches.entries()) {
      if (ts > cutoff) {
        obj[id] = ts;
      } else {
        handledDispatches.delete(id);
      }
    }
    await AsyncStorage.setItem(HANDLED_DISPATCHES_KEY, JSON.stringify(obj));
  } catch {
    // Non-fatal
  }
}

/**
 * Extracts reminderId and leadTime reliably whether from local notification or FCM push
 * (handling numbers, stringified numbers from FCM, deep links, or URLs).
 */
export function resolveDispatchId(
  data: unknown,
): { dispatchId: string; reminderId: string; leadTime: number } | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;

  let reminderId: string | null = null;
  if (typeof record.reminderId === "string" && record.reminderId.length > 0) {
    reminderId = record.reminderId;
  } else if (typeof record.url === "string") {
    const match = record.url.match(/reminder\/([^/?#]+)/i);
    if (match?.[1]) reminderId = match[1];
  } else if (typeof record.deepLink === "string") {
    const match = record.deepLink.match(/reminder\/([^/?#]+)/i);
    if (match?.[1]) reminderId = match[1];
  }

  if (!reminderId) return null;

  // Extract lead time (handles number or string "2" from FCM)
  let leadTime = 0;
  if (typeof record.leadTimeMinutes === "number") {
    leadTime = record.leadTimeMinutes;
  } else if (typeof record.leadTimeMinutes === "string") {
    const parsed = parseInt(record.leadTimeMinutes, 10);
    if (!Number.isNaN(parsed)) leadTime = parsed;
  } else if (typeof record.leadTime === "number") {
    leadTime = record.leadTime;
  } else if (typeof record.leadTime === "string") {
    const parsed = parseInt(record.leadTime, 10);
    if (!Number.isNaN(parsed)) leadTime = parsed;
  } else if (typeof record.dispatchId === "string") {
    const colon = record.dispatchId.lastIndexOf(":");
    if (colon > 0) {
      const parsed = parseInt(record.dispatchId.slice(colon + 1), 10);
      if (!Number.isNaN(parsed)) leadTime = parsed;
    }
  }

  const dispatchId = `${reminderId}:${leadTime}`;
  return { dispatchId, reminderId, leadTime };
}

export function isDispatchHandledRecently(
  reminderId: string,
  leadTime: number,
): boolean {
  const now = Date.now();
  const dispatchId = `${reminderId}:${leadTime}`;

  // 1. Exact match: was this specific alert (e.g. 2-minute pre-alert) handled within 10 min?
  const ts = handledDispatches.get(dispatchId);
  if (ts && now - ts < DEDUPE_WINDOW_MS) {
    return true;
  }

  // 2. Fuzzy match: did ANY alert for this exact reminderId fire within the last 45 seconds?
  // (A local alarm and a remote push for the same event arrive within 5-30 seconds of each other)
  const lastAlertTs = recentReminderAlerts.get(reminderId);
  if (lastAlertTs && now - lastAlertTs < FUZZY_ALERT_WINDOW_MS) {
    return true;
  }

  return false;
}

export function markDispatchHandled(
  reminderId: string,
  leadTime: number,
  authToken?: string | null,
) {
  const dispatchId = `${reminderId}:${leadTime}`;
  const now = Date.now();
  handledDispatches.set(dispatchId, now);
  recentReminderAlerts.set(reminderId, now);
  void persistHandledDispatches();

  // Asynchronously acknowledge with backend using either passed token or SecureStore token
  void (async () => {
    try {
      const token = authToken || (await tokenStorage.getToken());
      if (token) {
        await acknowledgeReminderDispatch(token, reminderId, leadTime);
      }
    } catch {
      // Non-fatal: local deduplication already protects the user
    }
  })();
}

/**
 * Must run early (imported from root layout). Controls what happens when a
 * notification fires while the app is open (foreground).
 */
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const resolved = resolveDispatchId(notification.request.content.data);
      if (resolved) {
        if (isDispatchHandledRecently(resolved.reminderId, resolved.leadTime)) {
          // Already presented or tapped within the dedupe window — suppress duplicate banner & sound!
          void Notifications.dismissNotificationAsync(notification.request.identifier);
          return {
            shouldPlaySound: false,
            shouldSetBadge: false,
            shouldShowBanner: false,
            shouldShowList: false,
          };
        }
        markDispatchHandled(resolved.reminderId, resolved.leadTime);
      }

      return {
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      };
    },
  });

  // Background / tray deduplication: if both local and remote push arrive in the system tray,
  // dismiss the duplicate card so only one notification is visible to the user.
  Notifications.addNotificationReceivedListener(async (notification) => {
    try {
      const resolved = resolveDispatchId(notification.request.content.data);
      if (!resolved) return;

      if (isDispatchHandledRecently(resolved.reminderId, resolved.leadTime)) {
        // Dismiss duplicate notification from status bar / notification drawer immediately
        await Notifications.dismissNotificationAsync(notification.request.identifier);
        return;
      }

      const presented = await Notifications.getPresentedNotificationsAsync();
      let matchCount = 0;
      for (const item of presented) {
        const itemResolved = resolveDispatchId(item.request.content.data);
        if (itemResolved && itemResolved.dispatchId === resolved.dispatchId) {
          matchCount++;
          if (matchCount > 1) {
            await Notifications.dismissNotificationAsync(item.request.identifier);
          }
        }
      }

      markDispatchHandled(resolved.reminderId, resolved.leadTime);
    } catch {
      // Non-fatal
    }
  });

  // Cache to ensure each notification action button click is processed exactly once
  const handledActionResponses = new Set<string>();

  async function handleNotificationActionResponse(
    response: Notifications.NotificationResponse | null | undefined,
  ) {
    if (!response) return;

    const actionId = response.actionIdentifier;
    const notifId = response.notification?.request?.identifier || "unknown";

    // Skip default notification body tap (handled by useNotificationNavigation to open reminder screen)
    if (
      !actionId ||
      actionId === Notifications.DEFAULT_ACTION_IDENTIFIER ||
      actionId === "expo.modules.notifications.actions.DEFAULT"
    ) {
      return;
    }

    const responseKey = `${notifId}:${actionId}`;
    if (handledActionResponses.has(responseKey)) {
      return;
    }
    handledActionResponses.add(responseKey);
    if (handledActionResponses.size > 50) {
      const firstKey = handledActionResponses.keys().next().value;
      if (firstKey) handledActionResponses.delete(firstKey);
    }

    try {
      // 1. Dismiss notification from status bar
      if (notifId && notifId !== "unknown") {
        try {
          await Notifications.dismissNotificationAsync(notifId);
        } catch {
          // Ignore
        }
      }
      void Notifications.clearLastNotificationResponseAsync().catch(() => {});

      const data = (response.notification.request.content.data || {}) as Record<string, unknown>;
      const resolved = resolveDispatchId(data);
      const reminderId =
        resolved?.reminderId ||
        (typeof data.reminderId === "string" ? data.reminderId : null) ||
        (typeof data.id === "string" ? data.id : null);

      if (resolved) {
        markDispatchHandled(resolved.reminderId, resolved.leadTime);
      } else if (reminderId) {
        markDispatchHandled(reminderId, 0);
      }

      // 2. "Mark done" action
      if (
        actionId === NOTIFICATION_ACTIONS.MARK_DONE ||
        actionId === "mark_done" ||
        actionId === "done"
      ) {
        if (reminderId) {
          await cancelReminderLocalNotification(reminderId);
          const token = await tokenStorage.getToken();
          if (token) {
            await updateReminder(token, reminderId, { status: "completed" });
          }
        }
        if (Platform.OS === "android") {
          ToastAndroid.show("Marked as done", ToastAndroid.SHORT);
          setTimeout(() => {
            BackHandler.exitApp();
          }, 300);
        }
        return;
      }

      // 3. "Snooze 10m" action
      if (
        actionId === NOTIFICATION_ACTIONS.SNOOZE_10 ||
        actionId === "snooze_10" ||
        actionId === "snooze"
      ) {
        const title =
          response.notification.request.content.title ||
          (typeof data.title === "string" ? data.title : "Reminder");
        const kind = typeof data.kind === "string" ? data.kind : "simple";
        const categoryIdentifier = resolveNotificationCategory(kind);
        const snoozeDispatchId = `${reminderId || "snooze"}:snooze_${Date.now()}`;
        const androidChannel =
          Platform.OS === "android" ? { channelId: REMINDERS_CHANNEL_ID } : {};

        try {
          await Notifications.scheduleNotificationAsync({
            content: {
              title,
              subtitle: "Snoozed · 10m",
              body: `Snooze alert: ${title}`,
              categoryIdentifier,
              autoDismiss: true,
              data: {
                ...data,
                reminderId: reminderId || "snooze",
                isSnoozed: true,
                dispatchId: snoozeDispatchId,
              },
              sound: true,
              ...androidChannel,
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
              seconds: 10 * 60,
              repeats: false,
              ...(Platform.OS === "android" ? { channelId: REMINDERS_CHANNEL_ID } : {}),
            },
          });
        } catch (snoozeErr) {
          if (__DEV__) {
            console.warn("Failed to schedule snooze:", snoozeErr);
          }
        }

        if (Platform.OS === "android") {
          ToastAndroid.show("Snoozed for 10 minutes", ToastAndroid.SHORT);
          setTimeout(() => {
            BackHandler.exitApp();
          }, 400);
        }
        return;
      }

      // 4. "Join meeting" action
      if (
        actionId === NOTIFICATION_ACTIONS.JOIN_MEETING ||
        actionId === "join" ||
        actionId === "join_meeting"
      ) {
        const actionObj =
          data.action && typeof data.action === "object"
            ? (data.action as Record<string, unknown>)
            : null;

        const rawLink =
          (typeof data.meetLink === "string" && data.meetLink.trim()) ||
          (typeof data.joinUrl === "string" && data.joinUrl.trim()) ||
          (actionObj && typeof actionObj.meetLink === "string" && actionObj.meetLink.trim()) ||
          (typeof data.notes === "string" && data.notes.match(/https?:\/\/[^\s]+/i)?.[0]) ||
          null;

        const title =
          response.notification.request.content.title ||
          (typeof data.title === "string" ? data.title : "Meeting");
        const cleanRoom = (title || "Meeting").replace(/[^a-zA-Z0-9]/g, "");
        const targetUrl =
          rawLink || `https://meet.jit.si/RoutineApp-${cleanRoom || "Room"}-${reminderId || "live"}`;

        let finalUrl = targetUrl.trim();
        if (!/^https?:\/\//i.test(finalUrl)) {
          finalUrl = `https://${finalUrl}`;
        }

        if (Platform.OS === "android") {
          ToastAndroid.show("Opening meeting...", ToastAndroid.SHORT);
        }

        try {
          await Linking.openURL(finalUrl);
        } catch (err) {
          if (__DEV__) {
            console.warn("Failed to open meeting URL:", err);
          }
          if (Platform.OS === "android") {
            ToastAndroid.show("Could not open meeting link", ToastAndroid.SHORT);
          }
        }

        if (Platform.OS === "android") {
          setTimeout(() => {
            BackHandler.exitApp();
          }, 500);
        }
        return;
      }
    } catch (err) {
      if (__DEV__) {
        console.warn("Error in notification action response listener:", err);
      }
    }
  }

  // Register listeners for both foreground/background events and cold starts
  Notifications.addNotificationResponseReceivedListener((response) => {
    void handleNotificationActionResponse(response);
  });

  void Notifications.getLastNotificationResponseAsync().then((response) => {
    if (response) {
      void handleNotificationActionResponse(response);
    }
  });

  AppState.addEventListener("change", (state) => {
    if (state !== "active") return;
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        void handleNotificationActionResponse(response);
      }
    });
  });
}
