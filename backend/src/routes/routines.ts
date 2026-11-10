import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { parseRoutineWithTools } from "../services/openaiRoutine";

const parseSchema = z.object({
  text: z.string().trim().min(1),
  timezone: z.string().trim().optional(),
});

export const routinesRouter = Router();

routinesRouter.use(requireAuth);

routinesRouter.post("/parse", async (req, res) => {
  const parsed = parseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid parse payload",
      details: parsed.error.flatten(),
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "OPENAI_API_KEY is not configured on the server" });
  }

  try {
    const result = await parseRoutineWithTools({
      userId: req.user!.id,
      text: parsed.data.text,
      timezone: parsed.data.timezone || "UTC",
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error("routines/parse failed:", error);
    const message =
      error instanceof Error ? error.message : "Failed to parse routine with OpenAI";
    return res.status(502).json({ error: message });
  }
});
