import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { registerExpoPushTokenWithBackend } from "@/notifications/register-push-token";

/**
 * After login (auth token ready), register this device's Expo push token.
 * Also re-runs when the app returns to foreground (covers permission granted
 * in Settings, and "updates on re-login" via lastSeenAt upsert).
 */
export function useRegisterPushToken(authToken: string | null) {
  const lastTokenRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (Platform.OS === "web") return;
    if (!authToken) {
      lastTokenRef.current = null;
      return;
    }

    let cancelled = false;

    async function run(reason: string) {
      if (!authToken || cancelled || inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const result = await registerExpoPushTokenWithBackend(authToken);
        if (__DEV__) {
          if (result.ok) {
            console.log(`[push] registered (${reason}):`, result.expoPushToken);
          } else {
            console.warn(`[push] skip (${reason}):`, result.reason);
          }
        }
        if (result.ok) {
          lastTokenRef.current = result.expoPushToken;
        }
      } finally {
        inFlightRef.current = false;
      }
    }

    void run("auth-ready");

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void run("foreground");
      }
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [authToken]);
}
