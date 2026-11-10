import { apiFetch } from "@/api/client";
import type { ReminderSummary as ReminderSummaryType } from "@/api/reminders";

export type { ReminderSummary } from "@/api/reminders";
export { listReminders } from "@/api/reminders";

export type ParseRoutineResponse = {
  transcript: string;
  assistantMessage: string;
  created: ReminderSummaryType[];
  updated: ReminderSummaryType[];
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
