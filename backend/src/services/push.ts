/**
 * Send remote pushes through Expo's Push API.
 * Expo forwards to FCM (Android) / APNs (iOS) using credentials on your EAS project.
 *
 * Docs: https://docs.expo.dev/push-notifications/sending-notifications/
 */

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  channelId?: string;
};

export type ExpoPushTicket = {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string; [key: string]: unknown };
};

export type SendExpoPushResult = {
  tickets: ExpoPushTicket[];
  sent: number;
  errors: string[];
};

function isExpoPushToken(token: string): boolean {
  return (
    token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken[")
  );
}

/**
 * POST one or more messages to Expo Push Service.
 * Returns per-token tickets (ok/error). Does not wait for FCM delivery receipts.
 */
export async function sendExpoPush(
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, unknown> = {},
): Promise<SendExpoPushResult> {
  const unique = [...new Set(tokens.map((t) => t.trim()).filter(Boolean))];
  const valid = unique.filter(isExpoPushToken);
  const errors: string[] = [];

  for (const token of unique) {
    if (!isExpoPushToken(token)) {
      errors.push(`Invalid Expo push token skipped: ${token.slice(0, 24)}…`);
    }
  }

  if (valid.length === 0) {
    return { tickets: [], sent: 0, errors: errors.length ? errors : ["No valid Expo push tokens"] };
  }

  const messages: ExpoPushMessage[] = valid.map((to) => ({
    to,
    title,
    body,
    data,
    sound: "default",
    // Matches the Android channel created in the mobile app (Feature 6.1).
    channelId: "reminders",
  }));

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/json",
  };

  // Optional: higher rate limits / project-scoped access if set in backend/.env
  const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(messages),
  });

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!response.ok) {
    const message =
      typeof parsed === "object" &&
      parsed !== null &&
      "errors" in parsed &&
      Array.isArray((parsed as { errors: unknown }).errors)
        ? JSON.stringify((parsed as { errors: unknown[] }).errors)
        : `Expo Push HTTP ${response.status}: ${text.slice(0, 300)}`;
    throw new Error(message);
  }

  const dataObj =
    typeof parsed === "object" && parsed !== null && "data" in parsed
      ? (parsed as { data: unknown }).data
      : parsed;

  const tickets: ExpoPushTicket[] = Array.isArray(dataObj)
    ? (dataObj as ExpoPushTicket[])
    : [];

  for (const ticket of tickets) {
    if (ticket.status === "error") {
      errors.push(ticket.message ?? ticket.details?.error ?? "Expo push ticket error");
    }
  }

  const sent = tickets.filter((t) => t.status === "ok").length;
  return { tickets, sent, errors };
}
