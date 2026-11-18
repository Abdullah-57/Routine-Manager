import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { markDispatchHandled, resolveDispatchId } from "./handler";

function reminderIdFromData(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;

  if (typeof record.reminderId === "string" && record.reminderId.length > 0) {
    return record.reminderId;
  }
  if (typeof record.id === "string" && record.id.length > 0) {
    return record.id;
  }

  // Fallback: parse /reminder/<id> from deep link payloads
  if (typeof record.url === "string") {
    const match = record.url.match(/reminder\/([^/?#]+)/i);
    if (match?.[1]) return match[1];
  }
  if (typeof record.deepLink === "string") {
    const match = record.deepLink.match(/reminder\/([^/?#]+)/i);
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
 * Tap a notification body → open that reminder.
 * Queues the target until auth/router are ready (cold start / background).
 *
 * Interactive action buttons (Mark done, Snooze 10m, Join meeting) are handled
 * silently in the background by handler.ts without opening the app.
 */
export function useNotificationNavigation(
  ready: boolean,
  authToken?: string | null,
) {
  const pendingIdRef = useRef<string | null>(null);
  const handledResponsesRef = useRef(new Set<string>());
  const authTokenRef = useRef<string | null>(authToken ?? null);

  useEffect(() => {
    authTokenRef.current = authToken ?? null;
  }, [authToken]);

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
      const actionId = response.actionIdentifier;
      const responseKey = `${notifId}:${actionId}`;

      // Prevent duplicate processing
      if (handledResponsesRef.current.has(responseKey)) return;
      handledResponsesRef.current.add(responseKey);

      // Interactive action buttons (Mark done, Snooze 10m, Join meeting) are
      // handled in handler.ts without navigating into the app.
      if (
        actionId &&
        actionId !== Notifications.DEFAULT_ACTION_IDENTIFIER &&
        actionId !== "expo.modules.notifications.actions.DEFAULT"
      ) {
        return;
      }

      const reminderId = reminderIdFromResponse(response);
      if (!reminderId) return;

      // Record dispatchId so delayed remote pushes are suppressed, and notify backend
      const resolved = resolveDispatchId(response.notification.request.content.data);
      if (resolved) {
        markDispatchHandled(resolved.reminderId, resolved.leadTime, authTokenRef.current);
      } else {
        markDispatchHandled(reminderId, 0, authTokenRef.current);
      }

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
