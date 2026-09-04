import { Router } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { ElevenLabsVoiceService } from "../services/voice/ElevenLabsVoiceService.js";

export const voiceRouter = Router();
const synthesizeInput = z.object({ text: z.string().trim().min(1).max(5000) });

voiceRouter.post("/synthesize", async (request: AuthenticatedRequest, response, next) => {
  const parsed = synthesizeInput.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: "Text is required" });
  try {
    const audio = await new ElevenLabsVoiceService().synthesize(parsed.data.text);
    response.type("audio/mpeg").send(audio);
  } catch (error) {
    next(error);
  }
});
