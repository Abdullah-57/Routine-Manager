import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { Device } from "../models/Device";

const registerSchema = z.object({
  expoPushToken: z
    .string()
    .trim()
    .min(10)
    .refine(
      (value) =>
        value.startsWith("ExponentPushToken[") ||
        value.startsWith("ExpoPushToken["),
      "expoPushToken must look like ExponentPushToken[...]",
    ),
  platform: z.enum(["ios", "android", "web", "unknown"]),
  deviceName: z.string().trim().max(120).optional(),
});

function publicDevice(device: {
  _id: { toString(): string };
  userId: { toString(): string };
  expoPushToken: string;
  platform: string;
  deviceName?: string | null;
  lastSeenAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    id: device._id.toString(),
    userId: device.userId.toString(),
    expoPushToken: device.expoPushToken,
    platform: device.platform,
    deviceName: device.deviceName ?? "",
    lastSeenAt: device.lastSeenAt,
    createdAt: device.createdAt,
    updatedAt: device.updatedAt,
  };
}

export const devicesRouter = Router();

/**
 * Upsert this phone's Expo push token for the signed-in user.
 * Re-login / app reopen updates lastSeenAt and re-binds the token to the user.
 */
devicesRouter.post("/register", requireAuth, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid device registration payload",
      details: parsed.error.flatten(),
    });
  }

  const { expoPushToken, platform, deviceName } = parsed.data;
  const userId = req.user!.id;

  const device = await Device.findOneAndUpdate(
    { expoPushToken },
    {
      $set: {
        userId,
        platform,
        deviceName: deviceName ?? "",
        lastSeenAt: new Date(),
      },
      $setOnInsert: {
        expoPushToken,
      },
    },
    {
      upsert: true,
      new: true,
      runValidators: true,
    },
  );

  return res.status(200).json({ device: publicDevice(device) });
});

/** Helper for Feature 6.2 testing — list devices for the current user. */
devicesRouter.get("/", requireAuth, async (req, res) => {
  const devices = await Device.find({ userId: req.user!.id }).sort({
    lastSeenAt: -1,
  });

  return res.status(200).json({
    devices: devices.map((device) => publicDevice(device)),
  });
});
