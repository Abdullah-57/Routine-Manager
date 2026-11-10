import type OpenAI from "openai";
import {
  createRemindersForUser,
  deleteReminderForUser,
  listRemindersForUser,
  updateReminderForUser,
  type ReminderDto,
} from "./reminders";

export type ToolExecutionRecord = {
  name: string;
  arguments: unknown;
  result: unknown;
};

export type ToolAffectSummary = {
  created: ReminderDto[];
  updated: ReminderDto[];
  deleted: Array<{ id: string }>;
};

export const routineTools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "create_reminders",
      description: "Create one or more reminders for the user",
      parameters: {
        type: "object",
        properties: {
          reminders: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                notes: { type: "string" },
                startAtISO: {
                  type: "string",
                  description: "ISO-8601 datetime with offset",
                },
                endAtISO: { type: "string" },
              },
              required: ["title", "startAtISO"],
              additionalProperties: false,
            },
          },
        },
        required: ["reminders"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_reminder",
      description: "Update an existing reminder by id",
      parameters: {
        type: "object",
        properties: {
          reminderId: { type: "string" },
          title: { type: "string" },
          notes: { type: "string" },
          startAtISO: { type: "string" },
          endAtISO: { type: "string" },
          status: {
            type: "string",
            enum: ["scheduled", "completed", "cancelled"],
          },
        },
        required: ["reminderId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_reminder",
      description: "Delete a reminder by id",
      parameters: {
        type: "object",
        properties: {
          reminderId: { type: "string" },
        },
        required: ["reminderId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_reminders",
      description:
        "List the user's reminders for a date range so you can update/delete the correct ones",
      parameters: {
        type: "object",
        properties: {
          fromISO: { type: "string" },
          toISO: { type: "string" },
        },
        required: ["fromISO", "toISO"],
        additionalProperties: false,
      },
    },
  },
];

type ToolContext = {
  userId: string;
  timezone: string;
  affect: ToolAffectSummary;
};

async function executeCreateReminders(args: unknown, ctx: ToolContext) {
  const payload = args as {
    reminders: Array<{
      title: string;
      notes?: string;
      startAtISO: string;
      endAtISO?: string;
    }>;
  };

  const { created, skippedDuplicates } = await createRemindersForUser(
    ctx.userId,
    ctx.timezone,
    payload.reminders ?? [],
  );
  ctx.affect.created.push(...created);
  return {
    created,
    skippedDuplicates,
    message:
      skippedDuplicates.length > 0
        ? `Skipped ${skippedDuplicates.length} duplicate reminder(s) with the same title, start date, and start time.`
        : undefined,
  };
}

async function executeUpdateReminder(args: unknown, ctx: ToolContext) {
  const payload = args as {
    reminderId: string;
    title?: string;
    notes?: string;
    startAtISO?: string;
    endAtISO?: string | null;
    status?: "scheduled" | "completed" | "cancelled";
  };

  const updated = await updateReminderForUser(ctx.userId, payload);
  ctx.affect.updated.push(updated);
  return { updated };
}

async function executeDeleteReminder(args: unknown, ctx: ToolContext) {
  const payload = args as { reminderId: string };
  const deleted = await deleteReminderForUser(ctx.userId, payload.reminderId);
  ctx.affect.deleted.push(deleted);
  return { deleted };
}

async function executeListReminders(args: unknown, ctx: ToolContext) {
  const payload = args as { fromISO: string; toISO: string };
  const reminders = await listRemindersForUser(
    ctx.userId,
    payload.fromISO,
    payload.toISO,
  );
  return { reminders };
}

export async function executeToolCall(
  name: string,
  rawArguments: string,
  ctx: ToolContext,
): Promise<{ record: ToolExecutionRecord; content: string }> {
  let parsedArgs: unknown = {};

  try {
    parsedArgs = rawArguments ? JSON.parse(rawArguments) : {};
  } catch {
    const record = {
      name,
      arguments: rawArguments,
      result: { error: "Invalid JSON arguments from model" },
    };
    return {
      record,
      content: JSON.stringify(record.result),
    };
  }

  try {
    let result: unknown;

    switch (name) {
      case "create_reminders":
        result = await executeCreateReminders(parsedArgs, ctx);
        break;
      case "update_reminder":
        result = await executeUpdateReminder(parsedArgs, ctx);
        break;
      case "delete_reminder":
        result = await executeDeleteReminder(parsedArgs, ctx);
        break;
      case "list_reminders":
        result = await executeListReminders(parsedArgs, ctx);
        break;
      default:
        result = { error: `Unknown tool: ${name}` };
    }

    const record = { name, arguments: parsedArgs, result };
    return { record, content: JSON.stringify(result) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool execution failed";
    const result = { error: message };
    const record = { name, arguments: parsedArgs, result };
    return { record, content: JSON.stringify(result) };
  }
}
