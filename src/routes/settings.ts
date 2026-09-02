import { Router } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { getSupabaseAdmin } from "../services/supabase.js";

const settingsInput = z.object({ aiGreetingEnabled: z.boolean(), aiGreetingText: z.string().trim().min(1).max(500) });
export const settingsRouter = Router();
settingsRouter.get("/", async (request: AuthenticatedRequest, response, next) => { try { const { data, error } = await getSupabaseAdmin().from("user_settings").select("ai_greeting_enabled,ai_greeting_text").eq("user_id", request.userId).maybeSingle(); if (error) throw error; response.json(data ?? { ai_greeting_enabled: true, ai_greeting_text: "Hi, this is {agent_name}, an AI assistant calling on behalf of {business_name}." }); } catch (error) { next(error); } });
settingsRouter.put("/", async (request: AuthenticatedRequest, response, next) => { const parsed = settingsInput.safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: "Invalid greeting settings" }); try { const input = parsed.data; const { data, error } = await getSupabaseAdmin().from("user_settings").upsert({ user_id: request.userId, ai_greeting_enabled: input.aiGreetingEnabled, ai_greeting_text: input.aiGreetingText, updated_at: new Date().toISOString() }).select().single(); if (error) throw error; response.json(data); } catch (error) { next(error); } });