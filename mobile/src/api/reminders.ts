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

export type ReminderStatus = "scheduled" | "completed" | "cancelled";

export type ListRemindersResponse = {
  reminders: ReminderSummary[];
};

export type ReminderDetailResponse = {
  reminder: ReminderSummary;
};

export type UpdateReminderInput = {
  title?: string;
  notes?: string;
  startAt?: string;
  endAt?: string | null;
  timezone?: string;
  status?: ReminderStatus;
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

export function updateReminder(
  token: string,
  id: string,
  input: UpdateReminderInput,
) {
  return apiFetch<ReminderDetailResponse>(`/reminders/${id}`, {
    method: "PATCH",
    token,
    body: input,
  });
}

export function deleteReminder(token: string, id: string) {
  return apiFetch<{ ok: boolean; id: string }>(`/reminders/${id}`, {
    method: "DELETE",
    token,
  });
}
