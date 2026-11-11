import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { Device } from "../models/Device";
import { sendExpoPush } from "../services/push";

const testSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  body: z.string().trim().min(1).max(200).optional(),
});

export const notificationsRouter = Router();

/**
 * Feature 6.3 — send a test remote push to every device registered for this user.
 * Requires a development/production build with FCM configured (not Expo Go).
 */
notificationsRouter.post("/test", requireAuth, async (req, res) => {
  const parsed = testSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid test notification payload",
      details: parsed.error.flatten(),
    });
  }

  const devices = await Device.find({ userId: req.user!.id }).select(
    "expoPushToken platform deviceName",
  );

  if (devices.length === 0) {
    return res.status(404).json({
      error:
        "No devices registered for this user. Open the app on your phone so it can POST /devices/register first.",
    });
  }

  const tokens = devices.map((d) => d.expoPushToken);
  const title = parsed.data.title ?? "Routine Manager test";
  const body =
    parsed.data.body ??
    "Remote push works — your backend reached this phone via Expo Push.";

  try {
    const result = await sendExpoPush(tokens, title, body, {
      type: "test",
      screen: "home",
    });

    return res.status(200).json({
      ok: result.sent > 0,
      deviceCount: devices.length,
      sent: result.sent,
      errors: result.errors,
      tickets: result.tickets,
      devices: devices.map((d) => ({
        platform: d.platform,
        deviceName: d.deviceName,
        expoPushToken: d.expoPushToken,
      })),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to send Expo push";
    return res.status(502).json({ error: message });
  }
});
