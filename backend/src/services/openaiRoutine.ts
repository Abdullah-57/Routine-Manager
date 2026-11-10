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

function buildSystemPrompt(timezone: string, now: Date) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  const localNow = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(now);

  const offset = getTimezoneOffsetISO(timezone, now);

  return [
    "You are a routine planning assistant.",
    "Convert the user's natural-language daily plan into concrete reminders.",
    "Use tools to create, update, or delete reminders.",
    "Interpret relative times using the user's timezone and today's date.",
    "Prefer fewer, clear reminders over noisy duplicates.",
    "Batch multiple new reminders into one create_reminders call when possible.",
    "Ask for clarification via a normal message only if time is genuinely ambiguous and cannot be reasonably inferred.",
    `User timezone: ${timezone}`,
    `Current UTC offset for that timezone: ${offset}`,
    `Today's date in user timezone (YYYY-MM-DD): ${today}`,
    `Current local datetime: ${localNow}`,
    `When creating reminders, always pass startAtISO/endAtISO using offset ${offset} (example: ${today}T09:00:00${offset}).`,
  ].join(" ");
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
}): Promise<ParseRoutineResult> {
  const client = getOpenAIClient();
  const model = getModel();
  const now = new Date();

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

  const session = await AiSession.create({
    userId: input.userId,
    inputType: "text",
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
