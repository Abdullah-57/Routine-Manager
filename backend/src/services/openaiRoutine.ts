import { Types } from "mongoose";
import OpenAI from "openai";
import { AiSession } from "../models/AiSession";
import { User } from "../models/User";
import { listRemindersForUser, startDateAndTimeInTimezone } from "./reminders";
import {
  executeToolCall,
  routineTools,
  type ToolAffectSummary,
  type ToolExecutionRecord,
} from "./tools";

// list_reminders → update/delete → final reply can need several steps
const MAX_TOOL_LOOPS = 5;

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing from environment");
  }
  return new OpenAI({ apiKey });
}

function getModel() {
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}

function getTimezoneOffsetISO(timezone: string, date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "longOffset",
  }).formatToParts(date);
  const raw = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  if (raw === "GMT" || raw === "UTC") return "+00:00";
  const match = raw.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
  if (!match) return "+00:00";
  const sign = match[1];
  const hours = match[2].padStart(2, "0");
  const minutes = (match[3] ?? "00").padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

function formatDateKeyInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Next Monday after today in the user's timezone (YYYY-MM-DD). */
function nextWeekMondayKey(timezone: string, now: Date): string {
  const todayKey = formatDateKeyInTimezone(now, timezone);
  // Use noon UTC on today's calendar date so weekday math is stable across offsets.
  const noonUtc = new Date(`${todayKey}T12:00:00.000Z`);
  const weekday = noonUtc.getUTCDay(); // 0=Sun ... 6=Sat
  const daysUntilNextMonday = ((8 - weekday) % 7) || 7;
  const nextMonday = new Date(noonUtc);
  nextMonday.setUTCDate(noonUtc.getUTCDate() + daysUntilNextMonday);
  return formatDateKeyInTimezone(nextMonday, timezone);
}

function formatLocalDateTimeParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return {
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}:${get("second")}`,
  };
}

function buildSystemPrompt(
  timezone: string,
  now: Date,
  defaultLeadTimes?: {
    simple?: number[];
    meeting?: number[];
    call?: number[];
    custom?: number[];
  },
) {
  const today = formatDateKeyInTimezone(now, timezone);
  const tomorrow = formatDateKeyInTimezone(
    new Date(now.getTime() + 24 * 60 * 60 * 1000),
    timezone,
  );
  const offset = getTimezoneOffsetISO(timezone, now);
  const nextWeekMonday = nextWeekMondayKey(timezone, now);
  const localParts = formatLocalDateTimeParts(now, timezone);
  const localNowIso = `${localParts.dateKey}T${localParts.time}${offset}`;

  const localNowPretty = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: "medium",
  }).format(now);

  const localNowPrettyTime12h = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(now);

  const meetingDefaults = defaultLeadTimes?.meeting ?? [60, 15];
  const callDefaults = defaultLeadTimes?.call ?? [15];
  const simpleDefaults = defaultLeadTimes?.simple ?? [];
  const customDefaults = defaultLeadTimes?.custom ?? [];

  return [
    "You are a routine planning assistant that both creates and manages reminders.",
    "Convert the user's natural-language daily plan into concrete reminders.",
    "Use tools to create, update, or delete reminders. Never invent reminder ids.",
    "Interpret relative times using the user's timezone and the exact Current local datetime below.",
    "Prefer fewer, clear reminders over noisy duplicates.",
    "Batch multiple new reminders into one create_reminders call when possible.",
    "",
    "MANDATORY DATE/TIME INFERENCE RULES (FOLLOW STRICTLY):",
    `1) Date given, no time: create a single timed reminder at 09:00 local that day (${today}T09:00:00${offset}). Do NOT invent a workday range.`,
    `2) Time given, no date (CRITICAL RULE):`,
    `   - Current local time is ${localParts.time} (${localNowPrettyTime12h}). Today is ${today}. Tomorrow is ${tomorrow}.`,
    `   - If the requested clock time is AHEAD of ${localParts.time} (${localNowPrettyTime12h}) today: schedule for TODAY (${today}). Example: user says '8 PM' when current time is ${localParts.time} -> ${today}T20:00:00${offset}.`,
    `   - If the requested clock time has ALREADY PASSED ${localParts.time} (${localNowPrettyTime12h}) today: schedule for TOMORROW (${tomorrow})! Example: user says '7 AM' when current time is ${localParts.time} -> ${tomorrow}T07:00:00${offset}.`,
    `   - NEVER schedule a reminder in the past for today when only a time was given!`,
    `3) Exact relative durations are NOT vague — compute them precisely from Current local datetime (${localNowIso}):`,
    `   - 'in N minutes' / 'N minutes from now' -> Current local datetime + N minutes (keep the resulting minute; do NOT round to :00 or the next hour).`,
    `   - 'in N hours' -> Current local datetime + N hours.`,
    `   - Example: if Current local datetime is 17:47 and user says '3 minutes from now', startAt must be 17:50 the same day — never 18:00.`,
    `4) Vague instructions (e.g. 'sometime next week', 'maybe', 'whenever', 'soon', 'later'): do NOT ask for clarification. Make a best-judgment assignment using Current local datetime and phrasing:`,
    `   - Defaults for vague timing: prefer 09:00 local unless context implies morning/afternoon/evening/night.`,
    `   - 'next week' / 'sometime next week' -> Monday ${nextWeekMonday} at 09:00 local (start of next calendar week).`,
    `   - 'this week' with no day -> the next upcoming weekday at 09:00 (skip past days; if none left, use next week's Monday).`,
    `   - 'soon' / 'later today' (without a numeric duration) -> today at the next reasonable hour (at least ~1 hour ahead), else tomorrow 09:00.`,
    `   - 'tomorrow morning/afternoon/evening' -> ${tomorrow} at 09:00 / 14:00 / 18:00 respectively.`,
    `5) Always pick a concrete startAtISO. In the assistant message, state the EXACT start time you put in the tool call (HH:mm), not a rounded guess.`,
    `6) Only ask a clarification question if the request has no actionable task at all (not merely vague timing).`,
    "",
    "MANAGE / UPDATE / DELETE RULES (FOLLOW STRICTLY):",
    "A) If the user wants to move, rename, reschedule, cancel, complete, or delete an existing reminder, identify it first.",
    "B) Prefer ids from the Existing upcoming reminders list below. If that list is empty or no clear match, call list_reminders with a wide range (yesterday -> end of next week) before update_reminder or delete_reminder.",
    "C) Match by title keywords case-insensitively (e.g. 'gym' matches 'Gym'). If several match, pick the soonest upcoming scheduled one unless the user was specific.",
    "D) 'Move X to 8am' / 'change X to ...' -> update_reminder with the new startAtISO (keep title unless asked to rename).",
    "E) 'Cancel X' -> update_reminder status=cancelled (keep the row). 'Delete/remove X' -> delete_reminder.",
    "F) Do not create a duplicate when the user clearly asked to change an existing item.",
    "G) MULTI-UTTERANCE & PRONOUN RESOLUTION (CRITICAL):",
    "   - In a multi-utterance conversation session, the user often refers to recently created or discussed reminders using pronouns or relative phrases like 'that one', 'it', 'move it', 'cancel that', 'the first one', 'change it to...', 'make it 10am instead'.",
    "   - Always resolve 'that one', 'it', 'that' to the most recently created or modified reminder in this conversation session!",
    "   - Match its id against the Existing upcoming reminders list and call update_reminder or delete_reminder directly.",
    "   - Never create a duplicate reminder when the user says 'move that one to ...' or 'make it ... instead'.",
    "",
    "H) ACTION-AWARE MEETINGS & INVITES (FOLLOW STRICTLY):",
    "   - When the user asks to schedule a meeting, call, or appointment with a person (e.g. 'Schedule a meeting with Alex at 5 PM', 'Set up a call with Sarah'):",
    "     1. Call find_contact with the person's name (e.g. name='Alex') to retrieve their email address.",
    "     2. Call create_meeting_link with the topic (e.g. topic='Meeting with Alex') to generate a video conference link.",
    "     3. If find_contact found an email address: call send_email to send the invitation with the meeting link.",
    "     4. Call create_reminders with kind='meeting', title='Meeting with Alex', startAtISO, meetLink, and attendees: [{ name: 'Alex', email: contact.email }]. Include the meeting link in the reminder notes.",
    "     5. If find_contact returned ambiguous contacts, still generate the meeting link, schedule the reminder, and ask the user to clarify which person to invite.",
    "     6. If no contact is found, still generate the meeting link, schedule the reminder with kind='meeting', and inform the user.",
    "",
    "I) SMART PRE-REMINDERS & LEAD TIMES (FOLLOW STRICTLY):",
    "   - Lead times represent alert minutes prior to startAt (e.g. [60, 15] means alerts 60m and 15m before).",
    `   - User default lead times:`,
    `     * meeting: [${meetingDefaults.join(", ")}] minutes before`,
    `     * call: [${callDefaults.join(", ")}] minutes before`,
    `     * simple: [${simpleDefaults.join(", ")}] (fires at event start time)`,
    `     * custom: [${customDefaults.join(", ")}]`,
    "   - When creating reminders (create_reminders):",
    "     * If user explicitly asks for a heads-up or pre-alert (e.g. 'remind me 15 minutes before', 'give me a 30m heads-up', 'alert me 1 hour and 15 minutes ahead'): pass those exact minutes in leadTimes: [15] (or [30], [60, 15]).",
    "     * If user explicitly says 'no pre-alert', 'no heads-up', or 'don't remind me early': pass leadTimes: [].",
    "     * If user does NOT mention pre-alerts: omit leadTimes so default lead times for that kind apply automatically.",
    "   - When user sets default pre-alerts (set_default_lead_times):",
    "     * If user says 'give me a heads-up 30 minutes before every meeting', 'set default meeting alert to 30m', 'remind me 10 minutes before calls by default': call set_default_lead_times with kind and leadTimes.",
    "   - When user updates pre-alerts on an existing reminder (update_reminder):",
    "     * If user says 'give me a 20 minute heads-up for that meeting', 'change the pre-alert to 45 minutes': call update_reminder with reminderId and leadTimes: [20].",
    "",
    `User timezone: ${timezone}`,
    `Current UTC offset for that timezone: ${offset}`,
    `Today's date in user timezone (YYYY-MM-DD): ${today}`,
    `Tomorrow's date in user timezone (YYYY-MM-DD): ${tomorrow}`,
    `Current local datetime: ${localNowPretty} (${localNowPrettyTime12h})`,
    `Current local datetime (ISO for math): ${localNowIso}`,
    `Next week starts (Monday): ${nextWeekMonday}`,
    `When creating or rescheduling reminders, always pass startAtISO/endAtISO using offset ${offset}.`,
  ].join("\n");
}

function formatReminderClock(
  isoOrDate: string | Date,
  timezone: string,
  now: Date,
): string {
  try {
    const date = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
    const { date: itemDate } = startDateAndTimeInTimezone(date, timezone);
    const { date: todayDate } = startDateAndTimeInTimezone(now, timezone);
    const tomorrowDate = formatDateKeyInTimezone(
      new Date(now.getTime() + 24 * 60 * 60 * 1000),
      timezone,
    );

    const timeStr = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
    }).format(date);

    if (itemDate === todayDate) {
      return `today at ${timeStr}`;
    }
    if (itemDate === tomorrowDate) {
      return `tomorrow at ${timeStr}`;
    }
    const dayStr = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(date);
    return `${dayStr} at ${timeStr}`;
  } catch {
    return String(isoOrDate);
  }
}

/** Prefer factual times from tool results so the UI message and TTS voice never invent wrong clocks. */
function buildFactualAssistantMessage(
  modelMessage: string,
  affect: ToolAffectSummary,
  timezone: string,
  now: Date,
): string {
  const parts: string[] = [];

  if (affect.defaultLeadTimesUpdated && affect.defaultLeadTimesUpdated.length > 0) {
    for (const update of affect.defaultLeadTimesUpdated) {
      const timesStr =
        update.leadTimes.length > 0
          ? update.leadTimes.map((m) => `${m} minutes`).join(" and ")
          : "no pre-alerts";
      parts.push(
        `I've set your default pre-alerts for ${update.kind} reminders to ${timesStr} before.`,
      );
    }
  }

  if (affect.created.length > 0) {
    if (affect.created.length === 1) {
      const item = affect.created[0];
      const when = formatReminderClock(item.startAt, item.timezone || timezone, now);
      if (item.kind === "meeting" || item.action?.meetLink) {
        const attendee = item.action?.attendees?.[0]?.email ? ` and sent the invite to ${item.action.attendees[0].email}` : "";
        parts.push(`I've scheduled ${item.title} for ${when} with a meeting link${attendee}.`);
      } else {
        parts.push(`I've scheduled ${item.title} for ${when}.`);
      }
    } else {
      const itemsList = affect.created
        .map(
          (item) =>
            `${item.title} (${formatReminderClock(item.startAt, item.timezone || timezone, now)})`,
        )
        .join(", ");
      parts.push(`I've scheduled ${affect.created.length} reminders: ${itemsList}.`);
    }
  }

  if (affect.updated.length > 0) {
    const itemsList = affect.updated
      .map(
        (item) =>
          `${item.title} (${item.status}) for ${formatReminderClock(item.startAt, item.timezone || timezone, now)}`,
      )
      .join(", ");
    parts.push(`Updated: ${itemsList}.`);
  }

  if (affect.deleted.length > 0) {
    parts.push(`Removed ${affect.deleted.length} reminder(s).`);
  }

  if (parts.length === 0) {
    return modelMessage;
  }

  return parts.join(" ");
}

async function buildExistingRemindersContext(
  userId: string,
  timezone: string,
  now: Date,
): Promise<string> {
  const offset = getTimezoneOffsetISO(timezone, now);
  const today = formatDateKeyInTimezone(now, timezone);
  // Wide window so "move gym" / "delete lunch" can resolve without an extra tool call.
  const fromISO = `${today}T00:00:00${offset}`;
  const end = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const endKey = formatDateKeyInTimezone(end, timezone);
  const toISO = `${endKey}T23:59:59${offset}`;

  try {
    const reminders = await listRemindersForUser(userId, fromISO, toISO);
    const upcoming = reminders.filter((item) => item.status === "scheduled").slice(0, 30);
    if (upcoming.length === 0) {
      return "Existing upcoming reminders: (none in the next ~14 days).";
    }
    const lines = upcoming.map((item) => {
      const when = formatReminderClock(item.startAt, item.timezone || timezone, now);
      const leadStr = item.leadTimes && item.leadTimes.length > 0 ? ` | leadTimes=[${item.leadTimes.join(",")}]` : "";
      return `- id=${item.id} | ${item.title} | ${when}${leadStr} | status=${item.status}`;
    });
    return `Existing upcoming reminders (use these ids for update/delete):\n${lines.join("\n")}`;
  } catch {
    return "Existing upcoming reminders: (unavailable — call list_reminders before updating).";
  }
}

export type ParseRoutineResult = {
  transcript: string;
  assistantMessage: string;
  created: ToolAffectSummary["created"];
  updated: ToolAffectSummary["updated"];
  deleted: ToolAffectSummary["deleted"];
  model: string;
  toolCalls: ToolExecutionRecord[];
  sessionId?: string;
};

export type ParseRoutineInput = {
  userId: string;
  text: string;
  timezone: string;
  sessionId?: string;
  inputType?: "text" | "audio";
};

export async function parseRoutineWithTools(
  input: ParseRoutineInput,
): Promise<ParseRoutineResult> {
  const client = getOpenAIClient();
  const model = getModel();
  const now = new Date();
  const inputType = input.inputType ?? "text";
  const incomingSessionId = input.sessionId?.trim();

  // 1. Try to find an existing active session (within last 30 minutes)
  let existingSession = null;
  if (incomingSessionId) {
    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
    existingSession = await AiSession.findOne({
      userId: input.userId,
      sessionId: incomingSessionId,
      updatedAt: { $gte: thirtyMinutesAgo },
    });
  }

  // 2. Fetch fresh upcoming reminders from DB (always reflects latest edits/deletions)
  const existingContext = await buildExistingRemindersContext(
    input.userId,
    input.timezone,
    now,
  );

  // 3. Reconstruct dialogue history for seamless multi-utterance context
  const previousDialogueMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  let multiTurnSessionContext = "";

  if (existingSession && existingSession.turns && existingSession.turns.length > 0) {
    const recentTurns = existingSession.turns.slice(-10);
    for (const turn of recentTurns) {
      if (turn.role === "user") {
        previousDialogueMessages.push({ role: "user", content: turn.content });
      } else if (turn.role === "assistant") {
        previousDialogueMessages.push({ role: "assistant", content: turn.content });
      }
    }

    multiTurnSessionContext = [
      "",
      "ACTIVE MULTI-TURN CONVERSATION SESSION:",
      `- This is a continuing hands-free conversation with the user in the same session (sessionId: ${incomingSessionId}).`,
      "- The user may refer to reminders from prior turns using pronouns or references like 'that one', 'it', 'move it', 'cancel that', 'the first one', or 'change it to...'.",
      "- Always resolve such references to the relevant reminder mentioned or created in previous turns above.",
      "- Update or reschedule the existing reminder rather than creating a duplicate reminder.",
    ].join("\n");
  }

  const user = await User.findById(input.userId).select("defaultLeadTimes");
  const defaultLeadTimes = (user?.defaultLeadTimes as any) ?? {
    simple: [],
    meeting: [60, 15],
    call: [15],
    custom: [],
  };

  const systemPromptContent = `${buildSystemPrompt(input.timezone, now, defaultLeadTimes)}\n\n${existingContext}${multiTurnSessionContext}`;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: systemPromptContent,
    },
    ...previousDialogueMessages,
    { role: "user", content: input.text },
  ];

  const affect: ToolAffectSummary = {
    created: [],
    updated: [],
    deleted: [],
    defaultLeadTimesUpdated: [],
  };
  const toolCalls: ToolExecutionRecord[] = [];

  let assistantMessage = "";

  for (let loop = 0; loop < MAX_TOOL_LOOPS; loop += 1) {
    const completion = await client.chat.completions.create({
      model,
      messages,
      tools: routineTools,
      tool_choice: "auto",
    });

    const choice = completion.choices[0];
    if (!choice) {
      throw new Error("OpenAI returned no choices");
    }

    const message = choice.message;
    messages.push(message);

    const calls = message.tool_calls ?? [];
    if (calls.length === 0) {
      assistantMessage = message.content?.trim() ?? "";
      break;
    }

    for (const call of calls) {
      if (call.type !== "function") {
        continue;
      }

      const executed = await executeToolCall(call.function.name, call.function.arguments, {
        userId: input.userId,
        timezone: input.timezone,
        affect,
      });

      toolCalls.push(executed.record);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: executed.content,
      });
    }

    if (loop === MAX_TOOL_LOOPS - 1) {
      assistantMessage =
        message.content?.trim() ||
        "I updated your reminders using the available tools.";
    }
  }

  if (!assistantMessage) {
    const createdCount = affect.created.length;
    const updatedCount = affect.updated.length;
    const deletedCount = affect.deleted.length;
    assistantMessage = `Done. Created ${createdCount}, updated ${updatedCount}, deleted ${deletedCount} reminder(s).`;
  }

  // Override with clock times from DB so the UI never shows a wrong rounded hour.
  assistantMessage = buildFactualAssistantMessage(
    assistantMessage,
    affect,
    input.timezone,
    now,
  );

  const targetSessionId =
    incomingSessionId || new Types.ObjectId().toString();

  if (existingSession) {
    existingSession.turns.push(
      { role: "user", content: input.text, createdAt: now },
      {
        role: "assistant",
        content: assistantMessage,
        toolCalls,
        createdAt: now,
      },
    );
    existingSession.rawTranscript = `${existingSession.rawTranscript}\n${input.text}`.trim();
    existingSession.assistantMessage = assistantMessage;
    for (const tc of toolCalls) {
      existingSession.toolCalls.push(tc);
    }
    await existingSession.save();
  } else {
    await AiSession.create({
      userId: input.userId,
      sessionId: targetSessionId,
      inputType,
      rawTranscript: input.text,
      model,
      toolCalls,
      assistantMessage,
      turns: [
        { role: "user", content: input.text, createdAt: now },
        {
          role: "assistant",
          content: assistantMessage,
          toolCalls,
          createdAt: now,
        },
      ],
    });
  }

  return {
    transcript: input.text,
    assistantMessage,
    created: affect.created,
    updated: affect.updated,
    deleted: affect.deleted,
    model,
    toolCalls,
    sessionId: targetSessionId,
  };
}
