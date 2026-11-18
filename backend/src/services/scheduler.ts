import { Reminder } from "../models/Reminder";
import { Device } from "../models/Device";
import { sendExpoPush } from "./push";

export type DispatchEvent = {
  reminderId: string;
  userId: string;
  title: string;
  kind: string;
  leadTime: number;
  scheduledFor: Date;
  devicesCount: number;
  sentCount: number;
  errors: string[];
};

export type DispatchReport = {
  timestamp: string;
  evaluatedRemindersCount: number;
  dispatched: DispatchEvent[];
  skippedPastCount: number;
};

function formatLeadDuration(mins: number): string {
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
  if (mins === 60) return "1 hour";
  if (mins % 1440 === 0) {
    const days = mins / 1440;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (mins % 60 === 0) {
    const hours = mins / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

/**
 * Evaluates all scheduled reminders whose alerts (lead-times or main startAt) are due right now.
 * Sends push notifications to all registered devices for the reminder owner.
 * Records the dispatched lead times in MongoDB to prevent double-firing.
 */
export async function dispatchDueReminders(targetNow?: Date): Promise<DispatchReport> {
  const now = targetNow || new Date();
  const nowMs = now.getTime();
  const windowLookbackMs = 10 * 60 * 1000; // 10-minute catchup window
  const windowStartMs = nowMs - windowLookbackMs;

  const dispatched: DispatchEvent[] = [];
  let skippedPastCount = 0;

  // Find all scheduled reminders that could have an alert due in this window
  const candidateReminders = await Reminder.find({
    status: "scheduled",
    startAt: { $gte: new Date(windowStartMs) },
  });

  for (const reminder of candidateReminders) {
    const startMs = reminder.startAt.getTime();
    // Unique list of alerts: 0 (main alert at startAt) plus any configured lead times > 0
    const leads = Array.from(
      new Set([0, ...(reminder.leadTimes || []).filter((m) => typeof m === "number" && m > 0)]),
    ).sort((a, b) => b - a);

    const alreadyDispatched = new Set(reminder.dispatchedLeadTimes || []);

    for (const leadTime of leads) {
      if (alreadyDispatched.has(leadTime)) {
        continue;
      }

      const alertTimeMs = startMs - leadTime * 60 * 1000;

      // Future alert, not due yet
      if (alertTimeMs > nowMs) {
        continue;
      }

      // Past alert older than catchup window: mark skipped so it doesn't stay pending forever
      if (alertTimeMs < windowStartMs) {
        await Reminder.updateOne(
          { _id: reminder._id },
          { $addToSet: { dispatchedLeadTimes: leadTime } },
        );
        alreadyDispatched.add(leadTime);
        skippedPastCount++;
        continue;
      }

      // Alert is DUE! (windowStartMs <= alertTimeMs <= nowMs)
      const devices = await Device.find({ userId: reminder.userId }).select("expoPushToken");
      const allTokens = Array.from(new Set(devices.map((d) => d.expoPushToken).filter(Boolean)));

      // Exclude devices that already scheduled this reminder locally on-device
      const localTokens = new Set((reminder as any).localScheduledTokens || []);
      const tokens = allTokens.filter((token) => !localTokens.has(token));

      const title = reminder.title || "Reminder";
      let body = "";
      const isPreAlert = leadTime > 0;

      if (isPreAlert) {
        const durationText = formatLeadDuration(leadTime);
        body = `Heads-up: ${reminder.title || "Reminder"} starts in ${durationText}.`;
        if (reminder.notes?.trim()) {
          body += `\n${reminder.notes.trim()}`;
        }
      } else {
        if (reminder.kind === "meeting") {
          body = "Your meeting is starting now.";
        } else if (reminder.kind === "call") {
          body = "Your call is starting now.";
        } else {
          body = reminder.notes?.trim() || "It's time for this routine item.";
        }
        if (reminder.notes?.trim() && (reminder.kind === "meeting" || reminder.kind === "call")) {
          body += `\n${reminder.notes.trim()}`;
        }
      }

      const data: Record<string, unknown> = {
        reminderId: reminder._id.toString(),
        screen: "reminder",
        url: `/reminder/${reminder._id.toString()}`,
        deepLink: `routine-manager://reminder/${reminder._id.toString()}`,
        isPreAlert,
        leadTimeMinutes: leadTime,
        dispatchId: `${reminder._id.toString()}:${leadTime}`,
        source: "server_dispatch",
        meetLink: reminder.action?.meetLink ?? null,
      };

      let sentCount = 0;
      const errors: string[] = [];

      if (tokens.length > 0) {
        try {
          const pushResult = await sendExpoPush(tokens, title, body, data);
          sentCount = pushResult.sent;
          errors.push(...pushResult.errors);
        } catch (pushErr) {
          errors.push(pushErr instanceof Error ? pushErr.message : "Failed to send push");
        }
      }

      // Atomically mark alert as dispatched in DB
      await Reminder.updateOne(
        { _id: reminder._id },
        { $addToSet: { dispatchedLeadTimes: leadTime } },
      );
      alreadyDispatched.add(leadTime);

      dispatched.push({
        reminderId: reminder._id.toString(),
        userId: reminder.userId.toString(),
        title,
        kind: reminder.kind || "simple",
        leadTime,
        scheduledFor: new Date(alertTimeMs),
        devicesCount: tokens.length,
        sentCount,
        errors,
      });
    }
  }

  return {
    timestamp: now.toISOString(),
    evaluatedRemindersCount: candidateReminders.length,
    dispatched,
    skippedPastCount,
  };
}

let schedulerInterval: NodeJS.Timeout | null = null;
let isRunning = false;

export function startScheduler(pollIntervalMs = 30_000) {
  if (schedulerInterval) return;

  console.log(`[Scheduler] Server-side reminder dispatch running every ${pollIntervalMs / 1000}s`);

  // Initial immediate check on startup
  void runTick();

  schedulerInterval = setInterval(() => {
    void runTick();
  }, pollIntervalMs);
}

async function runTick() {
  if (isRunning) return;
  isRunning = true;
  try {
    const report = await dispatchDueReminders();
    if (report.dispatched.length > 0) {
      console.log(
        `[Scheduler] Dispatched ${report.dispatched.length} reminder alert(s):`,
        report.dispatched.map(
          (d) =>
            `"${d.title}" (${d.leadTime === 0 ? "main" : `-${d.leadTime}m`}, devices: ${d.devicesCount}, sent: ${d.sentCount})`,
        ),
      );
    }
  } catch (err) {
    console.error("[Scheduler] Dispatch error:", err);
  } finally {
    isRunning = false;
  }
}

export function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log("[Scheduler] Server-side reminder dispatch stopped");
  }
}
