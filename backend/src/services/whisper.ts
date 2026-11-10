import OpenAI, { toFile } from "openai";

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing from environment");
  }
  return new OpenAI({ apiKey });
}

/** Current recommended file transcription model; override via OPENAI_TRANSCRIBE_MODEL. */
function getTranscribeModel() {
  return process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-transcribe";
}

export type TranscribeAudioInput = {
  buffer: Buffer;
  filename: string;
  mimeType?: string;
};

/**
 * Speech → text via OpenAI Audio Transcriptions API.
 * Docs: https://developers.openai.com/api/docs/guides/speech-to-text
 */
export async function transcribeAudio(
  input: TranscribeAudioInput,
): Promise<{ transcript: string; model: string }> {
  const client = getOpenAIClient();
  const model = getTranscribeModel();

  const file = await toFile(input.buffer, input.filename, {
    type: input.mimeType,
  });

  // Default response_format is json → { text, ... }. Docs: speech-to-text (gpt-transcribe).
  const result = await client.audio.transcriptions.create({
    file,
    model,
    // ISO-639-1 improves accuracy/latency for English routine phrases.
    language: "en",
  });

  const transcript = (result.text ?? "").trim();
  if (!transcript) {
    throw new Error("Transcription returned empty text");
  }

  return { transcript, model };
}
