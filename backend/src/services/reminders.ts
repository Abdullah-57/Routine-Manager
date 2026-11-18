import { Types } from "mongoose";
import { Reminder } from "../models/Reminder";
import { User } from "../models/User";

export type ReminderDto = {
  id: string;
  userId: string;
  title: string;
  notes: string;
  startAt: Date;
  endAt: Date | null;
  timezone: string;
  status: string;
  source: string;
  localNotificationId: string | null;
  kind?: string | null;
  leadTimes?: number[];
  dispatchedLeadTimes?: number[];
  action?: {
    type?: string | null;
    status?: string | null;
    meetLink?: string | null;
    attendees?: Array<{ name?: string | null; email?: string | null; inviteSentAt?: Date | null }>;
  } | null;
  createdAt?: Date;
  updatedAt?: Date;
};

export function toReminderDto(reminder: {
  _id: { toString(): string };
  userId: { toString(): string };
  title: string;
  notes?: string | null;
  startAt: Date;
  endAt?: Date | null;
  timezone?: string | null;
  status: string;
  source: string;
  localNotificationId?: string | null;
  kind?: string | null;
  leadTimes?: number[] | null;
  dispatchedLeadTimes?: number[] | null;
  action?: {
    type?: string | null;
    status?: string | null;
    meetLink?: string | null;
    attendees?: any;
  } | null;
  createdAt?: Date;
  updatedAt?: Date;
}): ReminderDto {
  return {
    id: reminder._id.toString(),
    userId: reminder.userId.toString(),
    title: reminder.title,
    notes: reminder.notes ?? "",
    startAt: reminder.startAt,
    endAt: reminder.endAt ?? null,
    timezone: reminder.timezone ?? "UTC",
    status: reminder.status,
    source: reminder.source,
    localNotificationId: reminder.localNotificationId ?? null,
    kind: reminder.kind ?? "simple",
    leadTimes: reminder.leadTimes ?? [],
    dispatchedLeadTimes: reminder.dispatchedLeadTimes ?? [],
    action: reminder.action
      ? {
          type: reminder.action.type ?? "none",
          status: reminder.action.status ?? "done",
          meetLink: reminder.action.meetLink ?? null,
          attendees: Array.isArray(reminder.action.attendees)
            ? reminder.action.attendees.map((a: any) => ({
                name: a.name ?? "",
                email: a.email ?? "",
                inviteSentAt: a.inviteSentAt,
              }))
            : [],
        }
      : null,
    createdAt: reminder.createdAt,
    updatedAt: reminder.updatedAt,
  };
}

function parseDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid datetime: ${value}`);
  }
  return date;
}

export async function listRemindersForUser(
  userId: string,
  fromISO: string,
  toISO: string,
): Promise<ReminderDto[]> {
  const from = parseDate(fromISO);
  const to = parseDate(toISO);

  const reminders = await Reminder.find({
    userId,
    startAt: { $gte: from, $lte: to },
  }).sort({ startAt: 1 });

  return reminders.map(toReminderDto);
}

/** Calendar date (YYYY-MM-DD) + clock time (HH:mm) in the given timezone. */
export function startDateAndTimeInTimezone(
  startAt: Date,
  timezone: string,
): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(startAt);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

/**
 * Duplicate = same title (case-insensitive) + same start date + same start time
 * (to the minute) in the user's timezone.
 */
function reminderDedupeKey(
  title: string,
  startAt: Date,
  timezone: string,
): string {
  const { date, time } = startDateAndTimeInTimezone(startAt, timezone);
  return `${title.trim().toLowerCase()}|${date}|${time}`;
}

export async function createRemindersForUser(
  userId: string,
  timezone: string,
  items: Array<{
    title: string;
    notes?: string;
    startAtISO: string;
    endAtISO?: string;
    kind?: "simple" | "meeting" | "call" | "custom";
    leadTimes?: number[];
    meetLink?: string;
    attendees?: Array<{ name?: string; email?: string }>;
  }>,
): Promise<{
  created: ReminderDto[];
  skippedDuplicates: Array<{ title: string; startAtISO: string }>;
}> {
  const user = await User.findById(userId).select("defaultLeadTimes");
  const userDefaults: Record<string, number[]> = (user?.defaultLeadTimes as any) ?? {
    simple: [],
    meeting: [60, 15],
    call: [15],
    custom: [],
  };

  const now = new Date();
  const prepared = items.map((item) => {
    let startAt = parseDate(item.startAtISO);
    let endAt = item.endAtISO ? parseDate(item.endAtISO) : undefined;

    // Rule 2 Universal Enforcement:
    // If a time was given on today's date that has already passed in the user's timezone,
    // roll it forward to tomorrow at that exact time so it is never scheduled in the past.
    const { date: itemDate } = startDateAndTimeInTimezone(startAt, timezone);
    const { date: todayDate } = startDateAndTimeInTimezone(now, timezone);

    if (itemDate === todayDate && startAt.getTime() < now.getTime()) {
      startAt = new Date(startAt.getTime() + 24 * 60 * 60 * 1000);
      if (endAt) {
        endAt = new Date(endAt.getTime() + 24 * 60 * 60 * 1000);
      }
    }

    if (endAt && endAt < startAt) {
      throw new Error(`endAt must be after startAt for "${item.title}"`);
    }

    const hasMeetLink = Boolean(item.meetLink);
    const kind = item.kind || (hasMeetLink ? "meeting" : "simple");
    const leadTimes = item.leadTimes !== undefined
      ? item.leadTimes
      : (userDefaults[kind] ?? (kind === "meeting" ? [60, 15] : kind === "call" ? [15] : []));

    const action = hasMeetLink || (item.attendees && item.attendees.length > 0)
      ? {
          type: (hasMeetLink ? "meeting_link" : "email") as "meeting_link" | "email",
          status: "done" as const,
          meetLink: item.meetLink,
          attendees: (item.attendees || []).map((a) => ({
            name: a.name || "",
            email: a.email || "",
            inviteSentAt: new Date(),
          })),
        }
      : undefined;

    const nowMs = now.getTime();
    const STALE_THRESHOLD_MS = 60 * 1000;
    const pastLeadTimes = (leadTimes || []).filter(
      (m) => startAt.getTime() - m * 60 * 1000 < nowMs - STALE_THRESHOLD_MS,
    );
    if (startAt.getTime() < nowMs - STALE_THRESHOLD_MS) {
      pastLeadTimes.push(0);
    }
    const dispatchedLeadTimes = Array.from(new Set(pastLeadTimes));

    return {
      userId,
      title: item.title.trim(),
      notes: item.notes?.trim() ?? "",
      startAt,
      endAt,
      timezone,
      kind,
      leadTimes,
      dispatchedLeadTimes,
      action,
      status: "scheduled" as const,
      source: "ai" as const,
      startAtISO: startAt.toISOString(),
    };
  });

  // Drop duplicates inside the same AI batch (same title + date + time).
  const seenInBatch = new Set<string>();
  const uniqueInBatch = prepared.filter((item) => {
    const key = reminderDedupeKey(item.title, item.startAt, timezone);
    if (seenInBatch.has(key)) return false;
    seenInBatch.add(key);
    return true;
  });

  let existingKeys = new Set<string>();

  if (uniqueInBatch.length > 0) {
    const startTimes = uniqueInBatch.map((item) => item.startAt.getTime());
    const windowStart = new Date(Math.min(...startTimes) - 24 * 60 * 60 * 1000);
    const windowEnd = new Date(Math.max(...startTimes) + 24 * 60 * 60 * 1000);

    // Pull nearby reminders, then compare by title + local date + local time.
    const existing = await Reminder.find({
      userId,
      startAt: { $gte: windowStart, $lte: windowEnd },
      status: { $ne: "cancelled" },
    }).select("title startAt timezone");

    existingKeys = new Set(
      existing.map((item) =>
        reminderDedupeKey(
          item.title,
          item.startAt,
          item.timezone || timezone,
        ),
      ),
    );
  }

  const skippedDuplicates: Array<{ title: string; startAtISO: string }> = [];
  const docsToInsert = uniqueInBatch.filter((item) => {
    const key = reminderDedupeKey(item.title, item.startAt, timezone);
    if (existingKeys.has(key)) {
      skippedDuplicates.push({
        title: item.title,
        startAtISO: item.startAtISO,
      });
      return false;
    }
    existingKeys.add(key);
    return true;
  });

  if (docsToInsert.length === 0) {
    return { created: [], skippedDuplicates };
  }

  const created = await Reminder.insertMany(
    docsToInsert.map(({ startAtISO: _startAtISO, ...doc }) => doc),
  );

  return {
    created: created.map(toReminderDto),
    skippedDuplicates,
  };
}

export async function updateReminderForUser(
  userId: string,
  input: {
    reminderId: string;
    title?: string;
    notes?: string;
    startAtISO?: string;
    endAtISO?: string | null;
    status?: "scheduled" | "completed" | "cancelled";
    kind?: "simple" | "meeting" | "call" | "custom";
    leadTimes?: number[];
    meetLink?: string;
    attendees?: Array<{ name?: string; email?: string }>;
  },
  timezone?: string,
): Promise<ReminderDto> {
  if (!Types.ObjectId.isValid(input.reminderId)) {
    throw new Error("Reminder not found");
  }

  const reminder = await Reminder.findOne({
    _id: input.reminderId,
    userId,
  });

  if (!reminder) {
    throw new Error("Reminder not found");
  }

  if (input.title !== undefined) reminder.title = input.title.trim();
  if (input.notes !== undefined) reminder.notes = input.notes.trim();
  if (input.kind !== undefined) reminder.kind = input.kind;
  if (input.leadTimes !== undefined) reminder.leadTimes = input.leadTimes;

  if (input.meetLink !== undefined || input.attendees !== undefined) {
    (reminder as any).action = {
      type: input.meetLink ? "meeting_link" : reminder.action?.type || "none",
      status: reminder.action?.status || "done",
      meetLink: input.meetLink ?? reminder.action?.meetLink ?? undefined,
      attendees: (input.attendees ?? reminder.action?.attendees ?? []).map((a: any) => ({
        name: a.name || "",
        email: a.email || "",
        inviteSentAt: a.inviteSentAt ? new Date(a.inviteSentAt) : new Date(),
      })),
    };
  }

  if (input.startAtISO !== undefined) {
    let startAt = parseDate(input.startAtISO);
    let endAt = input.endAtISO ? parseDate(input.endAtISO) : reminder.endAt;

    // Rule 2 Universal Enforcement:
    // If rescheduling to a clock time on today's date that has already passed,
    // roll it forward to tomorrow at that exact time so it is never scheduled in the past.
    const tz = timezone || reminder.timezone || "UTC";
    const now = new Date();
    const { date: itemDate } = startDateAndTimeInTimezone(startAt, tz);
    const { date: todayDate } = startDateAndTimeInTimezone(now, tz);

    if (itemDate === todayDate && startAt.getTime() < now.getTime()) {
      startAt = new Date(startAt.getTime() + 24 * 60 * 60 * 1000);
      if (endAt) {
        endAt = new Date(endAt.getTime() + 24 * 60 * 60 * 1000);
      }
    }

    reminder.startAt = startAt;
    if (input.endAtISO !== undefined) {
      reminder.endAt = endAt;
    }
  } else if (input.endAtISO !== undefined) {
    reminder.endAt = input.endAtISO ? parseDate(input.endAtISO) : undefined;
  }

  if (input.status !== undefined) reminder.status = input.status;

  if (input.startAtISO !== undefined || input.leadTimes !== undefined) {
    const nowMs = Date.now();
    const effectiveStart = reminder.startAt.getTime();
    const STALE_THRESHOLD_MS = 60 * 1000;
    const effectiveLeads = reminder.leadTimes || [];
    const pastLeadTimes = effectiveLeads.filter(
      (m) => effectiveStart - m * 60 * 1000 < nowMs - STALE_THRESHOLD_MS,
    );
    if (effectiveStart < nowMs - STALE_THRESHOLD_MS) {
      pastLeadTimes.push(0);
    }
    reminder.dispatchedLeadTimes = Array.from(new Set(pastLeadTimes));
  }

  if (reminder.endAt && reminder.endAt < reminder.startAt) {
    throw new Error("endAt must be after startAt");
  }

  await reminder.save();
  return toReminderDto(reminder);
}

export async function deleteReminderForUser(
  userId: string,
  reminderId: string,
): Promise<{ id: string }> {
  if (!Types.ObjectId.isValid(reminderId)) {
    throw new Error("Reminder not found");
  }

  const reminder = await Reminder.findOneAndDelete({
    _id: reminderId,
    userId,
  });

  if (!reminder) {
    throw new Error("Reminder not found");
  }

  return { id: reminder._id.toString() };
}
