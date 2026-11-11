import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";

function reminderIdFromData(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const record = data as { reminderId?: unknown; url?: unknown };

  if (typeof record.reminderId === "string" && record.reminderId.length > 0) {
    return record.reminderId;
  }

  // Fallback: parse /reminder/<id> from deep link payloads
  if (typeof record.url === "string") {
    const match = record.url.match(/reminder\/([^/?#]+)/i);
    if (match?.[1]) return match[1];
  }

  return null;
}

function reminderIdFromResponse(
  response: Notifications.NotificationResponse | null,
): string | null {
  if (!response) return null;
  return reminderIdFromData(response.notification.request.content.data);
}

function openReminder(reminderId: string) {
  // Imperative router works from root once navigation tree is mounted.
  router.push({
    pathname: "/reminder/[id]",
    params: { id: reminderId },
  });
}

/**
 * Tap a local notification → open that reminder.
 * Queues the target until auth/router are ready (cold start / background).
 */
export function useNotificationNavigation(ready: boolean) {
  const pendingIdRef = useRef<string | null>(null);
  const handledIdsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!ready) return;
    const pending = pendingIdRef.current;
    if (!pending) return;
    pendingIdRef.current = null;
    // Small delay so the root Stack exists after auth redirect.
    const timer = setTimeout(() => openReminder(pending), 250);
    return () => clearTimeout(timer);
  }, [ready]);

  useEffect(() => {
    if (Platform.OS === "web") return;

    function handleResponse(
      response: Notifications.NotificationResponse | null,
    ) {
      if (!response) return;

      const notifId = response.notification.request.identifier;
      if (handledIdsRef.current.has(notifId)) return;

      const reminderId = reminderIdFromResponse(response);
      if (!reminderId) return;

      handledIdsRef.current.add(notifId);

      if (!ready) {
        pendingIdRef.current = reminderId;
        return;
      }

      openReminder(reminderId);
      void Notifications.clearLastNotificationResponseAsync();
    }

    const sub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        handleResponse(response);
      },
    );

    // Cold start / app opened from a notification tap.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      handleResponse(response);
    });

    // When returning to foreground, re-check (some Android/Expo Go paths miss the listener).
    const appSub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void Notifications.getLastNotificationResponseAsync().then((response) => {
        handleResponse(response);
      });
    });

    return () => {
      sub.remove();
      appSub.remove();
    };
  }, [ready]);
}
