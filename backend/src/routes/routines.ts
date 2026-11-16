import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import OpenAI from "openai";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { parseRoutineWithTools } from "../services/openaiRoutine";
import { transcribeAudio } from "../services/whisper";

const parseTextSchema = z.object({
  text: z.string().trim().min(1),
  timezone: z.string().trim().optional(),
  sessionId: z.string().trim().optional(),
});

const ALLOWED_AUDIO_MIME = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
  "audio/flac",
  "video/mp4",
  "application/octet-stream",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // OpenAI Audio Transcriptions file size limit
  },
  fileFilter: (_req, file, cb) => {
    if (
      ALLOWED_AUDIO_MIME.has(file.mimetype) ||
      /\.(mp3|mp4|mpeg|mpga|m4a|wav|webm|ogg|flac)$/i.test(file.originalname)
    ) {
      cb(null, true);
      return;
    }
    cb(new Error(`Unsupported audio type: ${file.mimetype || file.originalname}`));
  },
});

export const routinesRouter = Router();

routinesRouter.use(requireAuth);

function resolveTimezone(body: unknown, req?: Request): string {
  if (
    body &&
    typeof body === "object" &&
    "timezone" in body &&
    typeof (body as { timezone: unknown }).timezone === "string" &&
    (body as { timezone: string }).timezone.trim()
  ) {
    const tz = (body as { timezone: string }).timezone.trim();
    if (tz && tz.toUpperCase() !== "UTC") {
      return tz;
    }
  }

  const headerTz = req?.headers["x-timezone"];
  if (
    typeof headerTz === "string" &&
    headerTz.trim() &&
    headerTz.trim().toUpperCase() !== "UTC"
  ) {
    return headerTz.trim();
  }

  if (
    body &&
    typeof body === "object" &&
    "timezone" in body &&
    typeof (body as { timezone: unknown }).timezone === "string" &&
    (body as { timezone: string }).timezone.trim()
  ) {
    return (body as { timezone: string }).timezone.trim();
  }

  return "UTC";
}

/** Run multer only for multipart so JSON { text } still works on the same path. */
function maybeAudioUpload(req: Request, res: Response, next: NextFunction) {
  const contentType = String(req.headers["content-type"] || "");
  if (!contentType.includes("multipart/form-data")) {
    next();
    return;
  }

  upload.single("audio")(req, res, (err: unknown) => {
    if (err) {
      const message = err instanceof Error ? err.message : "Audio upload failed";
      res.status(400).json({ error: message });
      return;
    }
    next();
  });
}

routinesRouter.post("/parse", maybeAudioUpload, async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({
      error: "OPENAI_API_KEY is not configured on the server",
    });
  }

  try {
    const timezone = resolveTimezone(req.body, req);
    const file = req.file;
    let text = "";
    let sessionId: string | undefined;
    let inputType: "text" | "audio" = "text";
    let transcriptionModel: string | undefined;

    if (file) {
      const transcribed = await transcribeAudio({
        buffer: file.buffer,
        filename: file.originalname || "audio.m4a",
        mimeType: file.mimetype,
      });
      text = transcribed.transcript;
      transcriptionModel = transcribed.model;
      inputType = "audio";
      if (typeof req.body?.sessionId === "string" && req.body.sessionId.trim()) {
        sessionId = req.body.sessionId.trim();
      }
    } else {
      const parsed = parseTextSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error:
            "Provide JSON { text, timezone?, sessionId? } or multipart form fields audio + timezone",
          details: parsed.error.flatten(),
        });
      }
      text = parsed.data.text;
      sessionId = parsed.data.sessionId;
    }

    const result = await parseRoutineWithTools({
      userId: req.user!.id,
      text,
      timezone,
      sessionId,
      inputType,
    });

    return res.status(200).json({
      ...result,
      transcript: text,
      inputType,
      ...(transcriptionModel ? { transcriptionModel } : {}),
    });
  } catch (error) {
    console.error("routines/parse failed:", error);
    const message =
      error instanceof Error ? error.message : "Failed to parse routine with OpenAI";
    return res.status(502).json({ error: message });
  }
});

/** Transcribe only (no reminder tool loop) — useful for Feature 5.1 acceptance / debugging. */
routinesRouter.post("/transcribe", upload.single("audio"), async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({
      error: "OPENAI_API_KEY is not configured on the server",
    });
  }

  if (!req.file) {
    return res.status(400).json({
      error: "multipart field 'audio' is required",
    });
  }

  try {
    const transcribed = await transcribeAudio({
      buffer: req.file.buffer,
      filename: req.file.originalname || "audio.m4a",
      mimeType: req.file.mimetype,
    });

    return res.status(200).json({
      transcript: transcribed.transcript,
      transcriptionModel: transcribed.model,
    });
  } catch (error) {
    console.error("routines/transcribe failed:", error);
    const message =
      error instanceof Error ? error.message : "Failed to transcribe audio";
    return res.status(502).json({ error: message });
  }
});

/**
 * Synthesizes speech using OpenAI TTS.
 * Used as a zero-setup audio fallback for post-wake conversation audio
 * when native expo-speech is not yet compiled into the current development build APK.
 */
routinesRouter.get("/tts", async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({
      error: "OPENAI_API_KEY is not configured on the server",
    });
  }

  const rawText =
    typeof req.query.text === "string" ? req.query.text.trim() : "";
  if (!rawText) {
    return res.status(400).json({
      error: "Query parameter 'text' is required",
    });
  }

  // Clean markdown and bullet symbols for natural spoken output
  const cleanText = rawText
    .replace(/^[-*•]\s+/gm, "")
    .replace(/[#*_`]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 1000);

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.audio.speech.create({
      model: "tts-1",
      voice: "alloy",
      input: cleanText,
      response_format: "mp3",
    });

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.set({
      "Content-Type": "audio/mpeg",
      "Content-Length": buffer.length.toString(),
      "Cache-Control": "public, max-age=86400",
    });
    return res.send(buffer);
  } catch (error) {
    console.error("routines/tts failed:", error);
    return res.status(502).json({ error: "Failed to synthesize speech" });
  }
});

