import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { Reminder } from "../models/Reminder";
import { User } from "../models/User";
import { startDateAndTimeInTimezone } from "../services/reminders";

const statusEnum = z.enum(["scheduled", "completed", "cancelled"]);
const sourceEnum = z.enum(["ai", "manual"]);
const kindEnum = z.enum(["simple", "meeting", "call", "custom"]);

const actionSchema = z.object({
  type: z.enum(["meeting_link", "email", "call", "none"]).optional(),
  status: z.enum(["pending", "done", "failed"]).optional(),
  meetLink: z.string().trim().optional().nullable(),
  attendees: z
    .array(
      z.object({
        name: z.string().trim().optional(),
        email: z.string().trim().optional(),
        inviteSentAt: z.coerce.date().optional(),
      }),
    )
    .optional(),
});

const createReminderSchema = z.object({
  title: z.string().trim().min(1),
  notes: z.string().trim().optional(),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }).optional(),
  timezone: z.string().trim().optional(),
  status: statusEnum.optional(),
  source: sourceEnum.optional(),
  localNotificationId: z.string().trim().optional(),
  kind: kindEnum.optional(),
  leadTimes: z.array(z.number().int().min(0)).optional(),
  action: actionSchema.optional(),
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
    kind: kindEnum.optional(),
    leadTimes: z.array(z.number().int().min(0)).optional(),
    action: actionSchema.optional(),
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
                inviteSentAt: a.inviteSentAt ?? null,
              }))
            : [],
        }
      : null,
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
  let startAt = new Date(data.startAt);
  let endAt = data.endAt ? new Date(data.endAt) : undefined;

  const tz = data.timezone ?? "UTC";
  const now = new Date();
  const { date: itemDate } = startDateAndTimeInTimezone(startAt, tz);
  const { date: todayDate } = startDateAndTimeInTimezone(now, tz);

  // Rule 2 Universal Enforcement:
  // If time was given on today's date that has already passed, schedule for tomorrow.
  if (itemDate === todayDate && startAt.getTime() < now.getTime()) {
    startAt = new Date(startAt.getTime() + 24 * 60 * 60 * 1000);
    if (endAt) {
      endAt = new Date(endAt.getTime() + 24 * 60 * 60 * 1000);
    }
  }

  if (endAt && endAt < startAt) {
    return res.status(400).json({ error: "endAt must be after startAt" });
  }

  const kind = data.kind ?? "simple";
  let leadTimes = data.leadTimes;
  if (leadTimes === undefined) {
    const user = await User.findById(req.user!.id).select("defaultLeadTimes");
    const userDefaults: Record<string, number[]> = (user?.defaultLeadTimes as any) ?? {
      simple: [],
      meeting: [60, 15],
      call: [15],
      custom: [],
    };
    leadTimes = userDefaults[kind] ?? (kind === "meeting" ? [60, 15] : kind === "call" ? [15] : []);
  }

  const nowMs = Date.now();
  const STALE_THRESHOLD_MS = 60 * 1000;
  const pastLeadTimes = (leadTimes || []).filter(
    (m) => startAt.getTime() - m * 60 * 1000 < nowMs - STALE_THRESHOLD_MS,
  );
  if (startAt.getTime() < nowMs - STALE_THRESHOLD_MS) {
    pastLeadTimes.push(0);
  }
  const dispatchedLeadTimes = Array.from(new Set(pastLeadTimes));

  const reminder = await Reminder.create({
    userId: req.user!.id,
    title: data.title,
    notes: data.notes ?? "",
    startAt,
    endAt,
    timezone: tz,
    status: data.status ?? "scheduled",
    source: data.source ?? "manual",
    localNotificationId: data.localNotificationId,
    kind,
    leadTimes,
    dispatchedLeadTimes,
    action: data.action
      ? {
          type: data.action.type ?? "none",
          status: data.action.status ?? "done",
          meetLink: data.action.meetLink ?? undefined,
          attendees: (data.action.attendees ?? []).map((a: any) => ({
            name: a.name || "",
            email: a.email || "",
            inviteSentAt: a.inviteSentAt ? new Date(a.inviteSentAt) : undefined,
          })),
        }
      : undefined,
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
  if (data.timezone !== undefined) reminder.timezone = data.timezone;
  if (data.status !== undefined) reminder.status = data.status;
  if (data.source !== undefined) reminder.source = data.source;
  if (data.kind !== undefined) reminder.kind = data.kind;
  if (data.leadTimes !== undefined) reminder.leadTimes = data.leadTimes;
  if (data.action !== undefined) {
    (reminder as any).action = data.action
      ? {
          type: data.action.type ?? reminder.action?.type ?? "none",
          status: data.action.status ?? reminder.action?.status ?? "done",
          meetLink: data.action.meetLink ?? reminder.action?.meetLink ?? undefined,
          attendees: (data.action.attendees ?? reminder.action?.attendees ?? []).map((a: any) => ({
            name: a.name || "",
            email: a.email || "",
            inviteSentAt: a.inviteSentAt ? new Date(a.inviteSentAt) : undefined,
          })),
        }
      : undefined;
  }

  if (data.startAt !== undefined) {
    let startAt = new Date(data.startAt);
    let endAt = data.endAt ? new Date(data.endAt) : reminder.endAt;
    const tz = data.timezone ?? reminder.timezone ?? "UTC";
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
    if (data.endAt !== undefined) {
      reminder.endAt = endAt;
    }
  } else if (data.endAt !== undefined) {
    reminder.endAt = data.endAt ? new Date(data.endAt) : undefined;
  }
  if (data.localNotificationId !== undefined) {
    reminder.localNotificationId = data.localNotificationId ?? undefined;
  }

  if (data.startAt !== undefined || data.leadTimes !== undefined) {
    const nowMs = Date.now();
    const STALE_THRESHOLD_MS = 60 * 1000;
    const effectiveStart = reminder.startAt.getTime();
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

/**
 * Feature 3.2 — Client Alert Acknowledgment.
 * When an alert (local alarm or push) is delivered/tapped on mobile, the client
 * calls this endpoint to record the leadTime in dispatchedLeadTimes.
 * This guarantees the server scheduler will not dispatch a redundant remote push.
 */
remindersRouter.post("/:id/acknowledge-dispatch", async (req, res) => {
  if (!Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).json({ error: "Reminder not found" });
  }

  const leadTime = typeof req.body?.leadTime === "number" ? req.body.leadTime : 0;

  const reminder = await Reminder.findOneAndUpdate(
    { _id: req.params.id, userId: req.user!.id },
    { $addToSet: { dispatchedLeadTimes: leadTime } },
    { new: true },
  );

  if (!reminder) {
    return res.status(404).json({ error: "Reminder not found" });
  }

  return res.status(200).json({
    ok: true,
    reminderId: reminder._id.toString(),
    dispatchedLeadTimes: reminder.dispatchedLeadTimes,
  });
});

/**
 * Feature 3.2 — Sync Local Scheduled Device Tokens.
 * Mobile app calls this with its active push token and the IDs of reminders that
 * it has scheduled as exact hardware alarms on-device.
 * The server scheduler excludes this device token from remote pushes for these reminders,
 * eliminating all duplicate notifications at the root.
 */
remindersRouter.post("/sync-local-tokens", async (req, res) => {
  const expoPushToken = typeof req.body?.expoPushToken === "string" ? req.body.expoPushToken.trim() : "";
  const reminderIds = Array.isArray(req.body?.reminderIds)
    ? req.body.reminderIds.filter((id: unknown): id is string => typeof id === "string" && Types.ObjectId.isValid(id))
    : [];

  if (!expoPushToken) {
    return res.status(400).json({ error: "expoPushToken is required" });
  }

  // 1. Add this device token to all reminders that are locally scheduled on this device
  if (reminderIds.length > 0) {
    await Reminder.updateMany(
      { _id: { $in: reminderIds }, userId: req.user!.id },
      { $addToSet: { localScheduledTokens: expoPushToken } },
    );
  }

  // 2. Remove this device token from any reminders that are no longer locally scheduled on this device
  await Reminder.updateMany(
    { _id: { $nin: reminderIds }, userId: req.user!.id, localScheduledTokens: expoPushToken },
    { $pull: { localScheduledTokens: expoPushToken } },
  );

  return res.status(200).json({
    ok: true,
    syncedReminderCount: reminderIds.length,
    expoPushToken,
  });
});
