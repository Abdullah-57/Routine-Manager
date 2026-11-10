import { apiFetch } from "@/api/client";
import type { ReminderSummary } from "@/api/routines";

export type { ReminderSummary };

export type ListRemindersResponse = {
  reminders: ReminderSummary[];
};

export type ReminderDetailResponse = {
  reminder: ReminderSummary;
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

export function getReminder(token: string, id: string) {
  return apiFetch<ReminderDetailResponse>(`/reminders/${id}`, {
    method: "GET",
    token,
  });
}
