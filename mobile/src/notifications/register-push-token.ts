import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { registerDevice } from "@/api/devices";
import { requestNotificationPermission } from "@/notifications/local-reminders";

function resolveEasProjectId(): string | null {
  // Prefer the runtime EAS config (dev client / production builds).
  const fromEasConfig = Constants.easConfig?.projectId;
  if (typeof fromEasConfig === "string" && fromEasConfig.length > 0) {
    return fromEasConfig;
  }

  // Fallback: app.json → expo.extra.eas.projectId (also set by `eas init`).
  const fromExtra = Constants.expoConfig?.extra?.eas?.projectId;
  if (typeof fromExtra === "string" && fromExtra.length > 0) {
    return fromExtra;
  }

  return null;
}

function platformForApi(): "ios" | "android" | "web" | "unknown" {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  if (Platform.OS === "web") return "web";
  return "unknown";
}

/**
 * Ask OS permission → fetch Expo push token → POST /devices/register.
 * Safe to call often: backend upserts by token; failures are logged, not thrown.
 */
export async function registerExpoPushTokenWithBackend(
  authToken: string,
): Promise<{ ok: true; expoPushToken: string } | { ok: false; reason: string }> {
  if (Platform.OS === "web") {
    return { ok: false, reason: "web_unsupported" };
  }

  const allowed = await requestNotificationPermission();
  if (!allowed) {
    return { ok: false, reason: "permission_denied" };
  }

  const projectId = resolveEasProjectId();
  if (!projectId) {
    return { ok: false, reason: "missing_project_id" };
  }

  let expoPushToken: string;
  try {
    // This talks to Expo's servers and (on Android) needs FCM credentials
    // configured for the EAS project. Local notifications do NOT need this.
    const result = await Notifications.getExpoPushTokenAsync({ projectId });
    expoPushToken = result.data;
  } catch (error) {
    if (__DEV__) {
      console.warn("getExpoPushTokenAsync failed:", error);
    }
    return {
      ok: false,
      reason:
        error instanceof Error ? error.message : "get_expo_push_token_failed",
    };
  }

  if (!expoPushToken) {
    return { ok: false, reason: "empty_token" };
  }

  try {
    await registerDevice(authToken, {
      expoPushToken,
      platform: platformForApi(),
      deviceName: Constants.deviceName ?? `${Platform.OS} device`,
    });
  } catch (error) {
    if (__DEV__) {
      console.warn("POST /devices/register failed:", error);
    }
    return {
      ok: false,
      reason:
        error instanceof Error ? error.message : "register_device_failed",
    };
  }

  if (__DEV__) {
    console.log("Registered Expo push token with backend:", expoPushToken);
  }

  return { ok: true, expoPushToken };
}
