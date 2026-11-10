import { Types } from "mongoose";
import { Reminder } from "../models/Reminder";

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
function startDateAndTimeInTimezone(
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
  }>,
): Promise<{
  created: ReminderDto[];
  skippedDuplicates: Array<{ title: string; startAtISO: string }>;
}> {
  const prepared = items.map((item) => {
    const startAt = parseDate(item.startAtISO);
    const endAt = item.endAtISO ? parseDate(item.endAtISO) : undefined;
    if (endAt && endAt < startAt) {
      throw new Error(`endAt must be after startAt for "${item.title}"`);
    }

    return {
      userId,
      title: item.title.trim(),
      notes: item.notes?.trim() ?? "",
      startAt,
      endAt,
      timezone,
      status: "scheduled" as const,
      source: "ai" as const,
      startAtISO: item.startAtISO,
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
  },
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
  if (input.startAtISO !== undefined) reminder.startAt = parseDate(input.startAtISO);
  if (input.endAtISO !== undefined) {
    reminder.endAt = input.endAtISO ? parseDate(input.endAtISO) : undefined;
  }
  if (input.status !== undefined) reminder.status = input.status;

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
