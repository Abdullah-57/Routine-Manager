import { apiFetch } from "@/api/client";

export type DeviceSummary = {
  id: string;
  userId: string;
  expoPushToken: string;
  platform: "ios" | "android" | "web" | "unknown" | string;
  deviceName: string;
  lastSeenAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

type RegisterResponse = {
  device: DeviceSummary;
};

type ListDevicesResponse = {
  devices: DeviceSummary[];
};

/**
 * Tell the backend how to reach this phone with Expo Push later (Feature 6.3).
 * Upserts by expoPushToken so re-login refreshes lastSeenAt.
 */
export function registerDevice(
  token: string,
  input: {
    expoPushToken: string;
    platform: "ios" | "android" | "web" | "unknown";
    deviceName?: string;
  },
) {
  return apiFetch<RegisterResponse>("/devices/register", {
    method: "POST",
    token,
    body: input,
  });
}

/** Debug helper — list devices stored for the signed-in user. */
export function listDevices(token: string) {
  return apiFetch<ListDevicesResponse>("/devices", { token });
}
