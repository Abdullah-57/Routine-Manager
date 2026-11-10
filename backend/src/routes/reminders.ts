import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { Reminder } from "../models/Reminder";

const statusEnum = z.enum(["scheduled", "completed", "cancelled"]);
const sourceEnum = z.enum(["ai", "manual"]);

const createReminderSchema = z.object({
  title: z.string().trim().min(1),
  notes: z.string().trim().optional(),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }).optional(),
  timezone: z.string().trim().optional(),
  status: statusEnum.optional(),
  source: sourceEnum.optional(),
  localNotificationId: z.string().trim().optional(),
});

const updateReminderSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    notes: z.string().trim().optional(),
    startAt: z.string().datetime({ offset: true }).optional(),
    endAt: z.string().datetime({ offset: true }).nullable().optional(),
    timezone: z.string().trim().optional(),
    status: statusEnum.optional(),
    source: sourceEnum.optional(),
    localNotificationId: z.string().trim().nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

/** Querystrings turn '+' into space, so "…00+03:00" arrives as "…00 03:00". */
const queryDateTime = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  return value.replace(/T(\d{2}:\d{2}:\d{2}(?:\.\d+)?) (\d{2}:\d{2})$/, "T$1+$2");
}, z.string().datetime({ offset: true }));

const listQuerySchema = z.object({
  from: queryDateTime.optional(),
  to: queryDateTime.optional(),
});

function publicReminder(reminder: {
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
}) {
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

export const remindersRouter = Router();

remindersRouter.use(requireAuth);

remindersRouter.get("/", async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }

  const filter: Record<string, unknown> = {
    userId: req.user!.id,
  };

  if (parsed.data.from || parsed.data.to) {
    const startAt: Record<string, Date> = {};
    if (parsed.data.from) startAt.$gte = new Date(parsed.data.from);
    if (parsed.data.to) startAt.$lte = new Date(parsed.data.to);
    filter.startAt = startAt;
  }

  const reminders = await Reminder.find(filter).sort({ startAt: 1 });
  return res.status(200).json({ reminders: reminders.map(publicReminder) });
});

remindersRouter.get("/:id", async (req, res) => {
  if (!Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "Reminder not found" });
  }

  const reminder = await Reminder.findOne({
    _id: req.params.id,
    userId: req.user!.id,
  });

  if (!reminder) {
    return res.status(404).json({ error: "Reminder not found" });
  }

  return res.status(200).json({ reminder: publicReminder(reminder) });
});

remindersRouter.post("/", async (req, res) => {
  const parsed = createReminderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid reminder payload", details: parsed.error.flatten() });
  }

  const data = parsed.data;
  const startAt = new Date(data.startAt);
  const endAt = data.endAt ? new Date(data.endAt) : undefined;

  if (endAt && endAt < startAt) {
    return res.status(400).json({ error: "endAt must be after startAt" });
  }

  const reminder = await Reminder.create({
    userId: req.user!.id,
    title: data.title,
    notes: data.notes ?? "",
    startAt,
    endAt,
    timezone: data.timezone ?? "UTC",
    status: data.status ?? "scheduled",
    source: data.source ?? "manual",
    localNotificationId: data.localNotificationId,
  });

  return res.status(201).json({ reminder: publicReminder(reminder) });
});

remindersRouter.patch("/:id", async (req, res) => {
  if (!Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "Reminder not found" });
  }

  const parsed = updateReminderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid reminder payload", details: parsed.error.flatten() });
  }

  const reminder = await Reminder.findOne({
    _id: req.params.id,
    userId: req.user!.id,
  });

  if (!reminder) {
    return res.status(404).json({ error: "Reminder not found" });
  }

  const data = parsed.data;

  if (data.title !== undefined) reminder.title = data.title;
  if (data.notes !== undefined) reminder.notes = data.notes;
  if (data.startAt !== undefined) reminder.startAt = new Date(data.startAt);
  if (data.endAt !== undefined) reminder.endAt = data.endAt ? new Date(data.endAt) : undefined;
  if (data.timezone !== undefined) reminder.timezone = data.timezone;
  if (data.status !== undefined) reminder.status = data.status;
  if (data.source !== undefined) reminder.source = data.source;
  if (data.localNotificationId !== undefined) {
    reminder.localNotificationId = data.localNotificationId ?? undefined;
  }

  if (reminder.endAt && reminder.endAt < reminder.startAt) {
    return res.status(400).json({ error: "endAt must be after startAt" });
  }

  await reminder.save();
  return res.status(200).json({ reminder: publicReminder(reminder) });
});

remindersRouter.delete("/:id", async (req, res) => {
  if (!Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "Reminder not found" });
  }

  const reminder = await Reminder.findOneAndDelete({
    _id: req.params.id,
    userId: req.user!.id,
  });

  if (!reminder) {
    return res.status(404).json({ error: "Reminder not found" });
  }

  return res.status(200).json({ ok: true, id: reminder._id.toString() });
});
