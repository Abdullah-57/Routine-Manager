import type OpenAI from "openai";
import { findContact } from "./contacts";
import { sendEmailMessage } from "./email";
import { generateMeetingLink } from "./meetingLinks";
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
      description:
        "Create one or more reminders for the user. Strictly follow universal date/time inference rules: (1) date given, no time -> 09:00 local; (2) time given, no date -> today if clock time is ahead, tomorrow if passed; (3) relative durations ('in N minutes/hours') -> compute precisely from current local datetime without rounding; (4) vague instructions ('next week') -> next Monday 09:00 local.",
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
                kind: {
                  type: "string",
                  enum: ["simple", "meeting", "call", "custom"],
                  description: "Kind of reminder. Use 'meeting' when scheduling meetings.",
                },
                meetLink: {
                  type: "string",
                  description: "Video meeting link generated via create_meeting_link",
                },
                attendees: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      email: { type: "string" },
                    },
                  },
                },
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
      description:
        "Update an existing reminder by id. Strictly follow universal manage rules: identify existing reminder by title keywords case-insensitively; 'move/change' -> update startAtISO; 'cancel' -> update status=cancelled; never create a duplicate when modifying an existing item.",
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
          kind: {
            type: "string",
            enum: ["simple", "meeting", "call", "custom"],
          },
          meetLink: {
            type: "string",
          },
          attendees: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                email: { type: "string" },
              },
            },
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
        "List the user's reminders for a date range so you can update/delete the correct ones. Call this before update_reminder or delete_reminder when the Existing upcoming reminders list is missing or ambiguous.",
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
  {
    type: "function",
    function: {
      name: "find_contact",
      description:
        "Look up a person's contact email or phone number by name from the user's contacts. Call this when scheduling a meeting, sending an email, or making a call to someone whose contact info is needed.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The person's name to search for, e.g. 'Alex'",
          },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_meeting_link",
      description:
        "Generate an instant encrypted video conference meeting link (Google Meet / Jitsi Meet) for a scheduled meeting.",
      parameters: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description: "Meeting topic or title, e.g. 'Meeting with Alex'",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_email",
      description:
        "Send an email message or meeting invitation to a recipient. Call this after finding the contact's email or when an email address is provided.",
      parameters: {
        type: "object",
        properties: {
          to: {
            type: "string",
            description: "Recipient email address",
          },
          subject: {
            type: "string",
            description: "Email subject line",
          },
          body: {
            type: "string",
            description: "Email body content",
          },
        },
        required: ["to", "subject", "body"],
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
      kind?: "simple" | "meeting" | "call" | "custom";
      meetLink?: string;
      attendees?: Array<{ name?: string; email?: string }>;
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
    kind?: "simple" | "meeting" | "call" | "custom";
    meetLink?: string;
    attendees?: Array<{ name?: string; email?: string }>;
  };

  const updated = await updateReminderForUser(ctx.userId, payload, ctx.timezone);
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

async function executeFindContact(args: unknown, ctx: ToolContext) {
  const payload = args as { name: string };
  return findContact(ctx.userId, payload.name);
}

async function executeCreateMeetingLink(args: unknown, ctx: ToolContext) {
  const payload = args as { topic?: string };
  return generateMeetingLink(ctx.userId, payload.topic);
}

async function executeSendEmail(args: unknown, ctx: ToolContext) {
  const payload = args as { to: string; subject: string; body: string };
  return sendEmailMessage(ctx.userId, payload.to, payload.subject, payload.body);
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
      case "find_contact":
        result = await executeFindContact(parsedArgs, ctx);
        break;
      case "create_meeting_link":
        result = await executeCreateMeetingLink(parsedArgs, ctx);
        break;
      case "send_email":
        result = await executeSendEmail(parsedArgs, ctx);
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
