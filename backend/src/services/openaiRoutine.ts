import OpenAI from "openai";
import { AiSession } from "../models/AiSession";
import {
  executeToolCall,
  routineTools,
  type ToolAffectSummary,
  type ToolExecutionRecord,
} from "./tools";

const MAX_TOOL_LOOPS = 3;

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

function buildSystemPrompt(timezone: string, now: Date) {
  const today = formatDateKeyInTimezone(now, timezone);
  const offset = getTimezoneOffsetISO(timezone, now);
  const nextWeekMonday = nextWeekMondayKey(timezone, now);
  const localParts = formatLocalDateTimeParts(now, timezone);
  const localNowIso = `${localParts.dateKey}T${localParts.time}${offset}`;

  const localNowPretty = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: "medium",
  }).format(now);

  return [
    "You are a routine planning assistant.",
    "Convert the user's natural-language daily plan into concrete reminders.",
    "Use tools to create, update, or delete reminders.",
    "Interpret relative times using the user's timezone and the exact Current local datetime below.",
    "Prefer fewer, clear reminders over noisy duplicates.",
    "Batch multiple new reminders into one create_reminders call when possible.",
    "Date/time inference rules (follow strictly):",
    "1) Date given, no time: create a single timed reminder at 09:00 local that day. Do NOT invent a full workday range (no 09:00–18:00) unless the user asked for a range or duration.",
    "2) Time given, no date: if that local clock time is still ahead of Current local datetime, use today; if that local clock time has already passed today, use tomorrow. Never schedule a reminder in the past when only a time was given.",
    "3) Exact relative durations are NOT vague — compute them precisely from Current local datetime:",
    "   'in N minutes' / 'N minutes from now' / 'about N minutes from now' → Current local datetime + N minutes (keep the resulting minute; do NOT round to :00 or the next hour).",
    "   'in N hours' → Current local datetime + N hours.",
    "   Example: if Current local datetime is 17:47 and user says '3 minutes from now', startAt must be 17:50 the same day — never 18:00.",
    "4) Vague instructions (e.g. 'sometime next week', 'maybe', 'whenever', 'soon', 'later'): do NOT ask for clarification. Make a best-judgment assignment using Current local datetime and the phrasing, then create the reminder.",
    "   Defaults for vague timing: prefer 09:00 local unless context implies morning/afternoon/evening/night.",
    `   'next week' / 'sometime next week' → Monday ${nextWeekMonday} at 09:00 local (start of next calendar week, not later this week).`,
    "   'this week' with no day → the next upcoming weekday at 09:00 (skip past days; if none left, use next week's Monday).",
    "   'soon' / 'later today' (without a numeric duration) → today at the next reasonable hour (at least ~1 hour ahead), else tomorrow 09:00.",
    "   'tomorrow morning/afternoon/evening' → tomorrow at 09:00 / 14:00 / 18:00 respectively.",
    "5) Always pick a concrete startAtISO. In the assistant message, state the EXACT start time you put in the tool call (HH:mm), not a rounded guess.",
    "6) Only ask a clarification question if the request has no actionable task at all (not merely vague timing).",
    `User timezone: ${timezone}`,
    `Current UTC offset for that timezone: ${offset}`,
    `Today's date in user timezone (YYYY-MM-DD): ${today}`,
    `Current local datetime: ${localNowPretty}`,
    `Current local datetime (ISO for math): ${localNowIso}`,
    `Next week starts (Monday): ${nextWeekMonday}`,
    `When creating reminders, always pass startAtISO/endAtISO using offset ${offset} (example: ${today}T09:00:00${offset}).`,
  ].join(" ");
}

function formatReminderClock(isoOrDate: string | Date, timezone: string): string {
  try {
    const date = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(date);
  } catch {
    return String(isoOrDate);
  }
}

/** Prefer factual times from tool results so the UI message never invents 6:00 for a 17:50 reminder. */
function buildFactualAssistantMessage(
  modelMessage: string,
  affect: ToolAffectSummary,
  timezone: string,
): string {
  if (affect.created.length === 0) {
    return modelMessage;
  }

  const lines = affect.created.map((item) => {
    const when = formatReminderClock(item.startAt, item.timezone || timezone);
    return `- ${item.title} at ${when}`;
  });

  return `Scheduled ${affect.created.length} reminder(s):\n${lines.join("\n")}`;
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

export async function parseRoutineWithTools(input: {
  userId: string;
  text: string;
  timezone: string;
  inputType?: "text" | "audio";
}): Promise<ParseRoutineResult> {
  const client = getOpenAIClient();
  const model = getModel();
  const now = new Date();
  const inputType = input.inputType ?? "text";

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt(input.timezone, now) },
    { role: "user", content: input.text },
  ];

  const affect: ToolAffectSummary = {
    created: [],
    updated: [],
    deleted: [],
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
  );

  const session = await AiSession.create({
    userId: input.userId,
    inputType,
    rawTranscript: input.text,
    model,
    toolCalls,
    assistantMessage,
  });

  return {
    transcript: input.text,
    assistantMessage,
    created: affect.created,
    updated: affect.updated,
    deleted: affect.deleted,
    model,
    toolCalls,
    sessionId: session._id.toString(),
  };
}
