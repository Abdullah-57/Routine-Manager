import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export const NOTIFICATION_CATEGORIES = {
  MEETING: "meeting",
  CALL: "call",
  SIMPLE: "simple",
} as const;

export const NOTIFICATION_ACTIONS = {
  JOIN_MEETING: "join_meeting",
  SNOOZE_10: "snooze_10",
  MARK_DONE: "mark_done",
} as const;

export function resolveNotificationCategory(kind?: string | null): string {
  if (kind === "meeting") return NOTIFICATION_CATEGORIES.MEETING;
  if (kind === "call") return NOTIFICATION_CATEGORIES.CALL;
  return NOTIFICATION_CATEGORIES.SIMPLE;
}

/**
 * Registers native interactive notification categories with Expo Notifications.
 *
 * Android & iOS display these action buttons in the notification drawer / banner:
 * - "meeting": [Join meeting, Snooze 10m, Mark done]
 * - "call":    [Snooze 10m, Mark done]
 * - "simple":  [Snooze 10m, Mark done]
 *
 * Note: opensAppToForeground is true so the OS reliably delivers the action event
 * to the app process. For actions like Mark Done and Snooze, the handler performs
 * the action and immediately finishes via BackHandler.exitApp(), so the user is
 * never taken into or kept inside the app.
 */
export async function setupNotificationCategories(): Promise<void> {
  if (Platform.OS === "web") return;

  try {
    // 1. Meeting category: Join meeting, Snooze 10m, Mark done
    await Notifications.setNotificationCategoryAsync(NOTIFICATION_CATEGORIES.MEETING, [
      {
        identifier: NOTIFICATION_ACTIONS.JOIN_MEETING,
        buttonTitle: "Join meeting",
        options: {
          opensAppToForeground: true,
        },
      },
      {
        identifier: NOTIFICATION_ACTIONS.SNOOZE_10,
        buttonTitle: "Snooze 10m",
        options: {
          opensAppToForeground: true,
        },
      },
      {
        identifier: NOTIFICATION_ACTIONS.MARK_DONE,
        buttonTitle: "Mark done",
        options: {
          opensAppToForeground: true,
          isDestructive: false,
        },
      },
    ]);

    // 2. Call category: Snooze 10m, Mark done
    await Notifications.setNotificationCategoryAsync(NOTIFICATION_CATEGORIES.CALL, [
      {
        identifier: NOTIFICATION_ACTIONS.SNOOZE_10,
        buttonTitle: "Snooze 10m",
        options: {
          opensAppToForeground: true,
        },
      },
      {
        identifier: NOTIFICATION_ACTIONS.MARK_DONE,
        buttonTitle: "Mark done",
        options: {
          opensAppToForeground: true,
          isDestructive: false,
        },
      },
    ]);

    // 3. Simple / routine category: Snooze 10m, Mark done
    await Notifications.setNotificationCategoryAsync(NOTIFICATION_CATEGORIES.SIMPLE, [
      {
        identifier: NOTIFICATION_ACTIONS.SNOOZE_10,
        buttonTitle: "Snooze 10m",
        options: {
          opensAppToForeground: true,
        },
      },
      {
        identifier: NOTIFICATION_ACTIONS.MARK_DONE,
        buttonTitle: "Mark done",
        options: {
          opensAppToForeground: true,
          isDestructive: false,
        },
      },
    ]);
  } catch (err) {
    if (__DEV__) {
      console.warn("Failed to set up notification categories:", err);
    }
  }
}
