import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { acknowledgeReminderDispatch } from "@/api/reminders";
import { tokenStorage } from "@/auth/token-storage";

const HANDLED_DISPATCHES_KEY = "handledReminderDispatches.v1";
const DEDUPE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes for exact alert matches
const FUZZY_ALERT_WINDOW_MS = 45 * 1000; // 45 seconds: any second alert for same reminderId is a duplicate

/** In-memory cache of exact dispatchId ("<reminderId>:<leadTime>") -> timestamp (ms) */
const handledDispatches = new Map<string, number>();

/** In-memory cache of reminderId -> last alert timestamp (ms) to catch local vs push duplicate races */
const recentReminderAlerts = new Map<string, number>();

// Load persisted handled dispatches on startup
if (Platform.OS !== "web") {
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
}
