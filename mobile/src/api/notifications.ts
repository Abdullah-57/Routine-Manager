import { apiFetch } from "@/api/client";

export type TestPushResponse = {
  ok: boolean;
  deviceCount: number;
  sent: number;
  errors: string[];
  tickets: Array<{
    status: "ok" | "error";
    id?: string;
    message?: string;
  }>;
};

/**
 * Ask the backend to send a remote Expo push to this user's registered devices.
 */
export function sendTestPush(
  token: string,
  input?: { title?: string; body?: string },
) {
  return apiFetch<TestPushResponse>("/notifications/test", {
    method: "POST",
    token,
    body: input ?? {},
  });
}
