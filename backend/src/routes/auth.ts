import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { User } from "../models/User";
import { requireAuth, signAuthToken } from "../middleware/auth";

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().trim().optional(),
  timezone: z.string().trim().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function publicUser(user: {
  _id: { toString(): string };
  email: string;
  displayName?: string | null;
  timezone?: string | null;
  defaultLeadTimes?: {
    simple?: number[];
    meeting?: number[];
    call?: number[];
    custom?: number[];
  } | null;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    id: user._id.toString(),
    email: user.email,
    displayName: user.displayName ?? "",
    timezone: user.timezone ?? "UTC",
    defaultLeadTimes: {
      simple: user.defaultLeadTimes?.simple ?? [],
      meeting: user.defaultLeadTimes?.meeting ?? [60, 15],
      call: user.defaultLeadTimes?.call ?? [15],
      custom: user.defaultLeadTimes?.custom ?? [],
    },
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export const authRouter = Router();

authRouter.post("/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid signup payload", details: parsed.error.flatten() });
  }

  const { email, password, displayName, timezone } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    return res.status(409).json({ error: "Email already registered" });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({
    email: normalizedEmail,
    passwordHash,
    displayName: displayName ?? "",
    timezone: timezone ?? "UTC",
  });

  const token = signAuthToken(user._id.toString(), user.email);

  return res.status(201).json({
    token,
    user: publicUser(user),
  });
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid login payload", details: parsed.error.flatten() });
  }

  const { email, password } = parsed.data;
  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const token = signAuthToken(user._id.toString(), user.email);

  return res.status(200).json({
    token,
    user: publicUser(user),
  });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await User.findById(req.user!.id).select("-passwordHash");

  if (!user) {
    return res.status(401).json({ error: "User not found" });
  }

  return res.status(200).json({ user: publicUser(user) });
});

authRouter.patch("/me", requireAuth, async (req, res) => {
  const leadTimesArraySchema = z.array(z.number().int().min(0));
  const patchSchema = z.object({
    timezone: z.string().trim().optional(),
    displayName: z.string().trim().optional(),
    defaultLeadTimes: z
      .object({
        simple: leadTimesArraySchema.optional(),
        meeting: leadTimesArraySchema.optional(),
        call: leadTimesArraySchema.optional(),
        custom: leadTimesArraySchema.optional(),
      })
      .optional(),
  });

  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const user = await User.findById(req.user!.id);
  if (!user) {
    return res.status(401).json({ error: "User not found" });
  }

  if (parsed.data.timezone) {
    user.timezone = parsed.data.timezone;
  }
  if (parsed.data.displayName !== undefined) {
    user.displayName = parsed.data.displayName;
  }
  if (parsed.data.defaultLeadTimes) {
    if (!user.defaultLeadTimes) {
      user.defaultLeadTimes = { simple: [], meeting: [60, 15], call: [15], custom: [] };
    }
    if (parsed.data.defaultLeadTimes.simple !== undefined) {
      user.defaultLeadTimes.simple = parsed.data.defaultLeadTimes.simple;
    }
    if (parsed.data.defaultLeadTimes.meeting !== undefined) {
      user.defaultLeadTimes.meeting = parsed.data.defaultLeadTimes.meeting;
    }
    if (parsed.data.defaultLeadTimes.call !== undefined) {
      user.defaultLeadTimes.call = parsed.data.defaultLeadTimes.call;
    }
    if (parsed.data.defaultLeadTimes.custom !== undefined) {
      user.defaultLeadTimes.custom = parsed.data.defaultLeadTimes.custom;
    }
  }

  await user.save();
  return res.status(200).json({ user: publicUser(user) });
});
