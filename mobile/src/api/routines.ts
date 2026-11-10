import { apiFetch } from "@/api/client";

export type ReminderSummary = {
  id: string;
  userId: string;
  title: string;
  notes: string;
  startAt: string;
  endAt: string | null;
  timezone: string;
  status: string;
  source: string;
  localNotificationId: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type ParseRoutineResponse = {
  transcript: string;
  assistantMessage: string;
  created: ReminderSummary[];
  updated: ReminderSummary[];
  deleted: Array<{ id: string }>;
  model?: string;
  sessionId?: string;
};

export function parseRoutine(
  token: string,
  input: { text: string; timezone?: string },
) {
  return apiFetch<ParseRoutineResponse>("/routines/parse", {
    method: "POST",
    token,
    body: input,
  });
}

export type ListRemindersResponse = {
  reminders: ReminderSummary[];
};

export function listReminders(
  token: string,
  range?: { fromISO?: string; toISO?: string },
) {
  const params = new URLSearchParams();
  if (range?.fromISO) params.set("from", range.fromISO);
  if (range?.toISO) params.set("to", range.toISO);
  const query = params.toString();

  return apiFetch<ListRemindersResponse>(
    `/reminders${query ? `?${query}` : ""}`,
    {
      method: "GET",
      token,
    },
  );
}
