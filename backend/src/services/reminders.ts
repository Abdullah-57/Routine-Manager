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

export async function createRemindersForUser(
  userId: string,
  timezone: string,
  items: Array<{
    title: string;
    notes?: string;
    startAtISO: string;
    endAtISO?: string;
  }>,
): Promise<ReminderDto[]> {
  const docs = items.map((item) => {
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
    };
  });

  const created = await Reminder.insertMany(docs);
  return created.map(toReminderDto);
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
