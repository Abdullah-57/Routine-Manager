import {
  FileSystemUploadType,
  uploadAsync,
} from "expo-file-system/legacy";
import { ApiError, apiFetch, getBaseUrl } from "@/api/client";
import type { ReminderSummary as ReminderSummaryType } from "@/api/reminders";

export type { ReminderSummary } from "@/api/reminders";
export { listReminders } from "@/api/reminders";

export type ParseRoutineResponse = {
  transcript: string;
  assistantMessage: string;
  created: ReminderSummaryType[];
  updated: ReminderSummaryType[];
  deleted: Array<{ id: string }>;
  model?: string;
  sessionId?: string;
  inputType?: "text" | "audio";
  transcriptionModel?: string;
};

export function parseRoutine(
  token: string,
  input: { text: string; timezone?: string },
) {
  return apiFetch<ParseRoutineResponse>("/routines/parse", {
    method: "POST",
    token,
    body: input,
  });
}

function normalizeFileUri(uri: string): string {
  // Android FormData/upload often needs an explicit file:// prefix.
  if (uri.startsWith("file://") || uri.startsWith("content://")) {
    return uri;
  }
  return `file://${uri}`;
}

/**
 * Upload a recorded audio file to /routines/parse.
 * Uses expo-file-system native multipart upload — React Native fetch+FormData
 * file uploads often fail on Android with a generic "Network request failed".
 */
async function uploadAudioMultipart(
  path: string,
  token: string,
  input: {
    uri: string;
    timezone?: string;
    mimeType?: string;
  },
): Promise<unknown> {
  const url = `${getBaseUrl()}${path}`;
  const fileUri = normalizeFileUri(input.uri);
  const mimeType = input.mimeType ?? "audio/mp4";

  let result;
  try {
    result = await uploadAsync(url, fileUri, {
      httpMethod: "POST",
      uploadType: FileSystemUploadType.MULTIPART,
      fieldName: "audio",
      mimeType,
      parameters: {
        timezone: input.timezone ?? "UTC",
      },
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Unknown upload error";
    throw new ApiError(
      `Voice upload failed — is the backend reachable at ${getBaseUrl()}? (${detail})`,
      0,
      "NETWORK_ERROR",
    );
  }

  let data: unknown = null;
  if (result.body) {
    try {
      data = JSON.parse(result.body);
    } catch {
      data = result.body;
    }
  }

  if (result.status < 200 || result.status >= 300) {
    const message =
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `HTTP ${result.status}`;
    throw new ApiError(message, result.status);
  }

  return data;
}

export async function parseRoutineAudio(
  token: string,
  input: {
    uri: string;
    timezone?: string;
    filename?: string;
    mimeType?: string;
  },
): Promise<ParseRoutineResponse> {
  const data = await uploadAudioMultipart("/routines/parse", token, input);
  return data as ParseRoutineResponse;
}

/** Transcribe only — puts text in the composer; user submits separately. */
export async function transcribeRoutineAudio(
  token: string,
  input: {
    uri: string;
    mimeType?: string;
  },
): Promise<{ transcript: string; transcriptionModel?: string }> {
  const data = await uploadAudioMultipart("/routines/transcribe", token, input);
  const payload = data as { transcript?: unknown; transcriptionModel?: string };
  if (typeof payload.transcript !== "string" || !payload.transcript.trim()) {
    throw new ApiError("No transcript returned from the server.", 502);
  }
  return {
    transcript: payload.transcript.trim(),
    transcriptionModel: payload.transcriptionModel,
  };
}
