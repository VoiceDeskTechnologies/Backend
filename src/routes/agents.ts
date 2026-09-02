import { Router } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { getSupabaseAdmin } from "../services/supabase.js";

const agentInput = z.object({ name: z.string().trim().min(1).max(80), role: z.string().trim().min(1).max(120), personality: z.string().trim().min(1).max(500), greeting: z.string().trim().min(1).max(500), systemInstructions: z.string().trim().min(1).max(4000), disclosureEnabled: z.boolean().default(true), disclosureText: z.string().trim().max(500).nullable().default(null) });
export const agentsRouter = Router();

agentsRouter.get("/", async (request: AuthenticatedRequest, response, next) => {
  try { const { data, error } = await getSupabaseAdmin().from("ai_agents").select("*").eq("user_id", request.userId).order("created_at", { ascending: false }); if (error) throw error; response.json(data); } catch (error) { next(error); }
});
agentsRouter.post("/", async (request: AuthenticatedRequest, response, next) => {
  const parsed = agentInput.safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: "Invalid agent details", fields: parsed.error.flatten().fieldErrors });
  try { const input = parsed.data; const { data, error } = await getSupabaseAdmin().from("ai_agents").insert({ user_id: request.userId, name: input.name, role: input.role, personality: input.personality, greeting: input.greeting, system_instructions: input.systemInstructions, disclosure_enabled: input.disclosureEnabled, disclosure_text: input.disclosureText }).select().single(); if (error) throw error; response.status(201).json(data); } catch (error) { next(error); }
});
agentsRouter.delete("/:id", async (request: AuthenticatedRequest, response, next) => {
  try { const { error } = await getSupabaseAdmin().from("ai_agents").delete().eq("id", request.params.id).eq("user_id", request.userId); if (error) throw error; response.status(204).send(); } catch (error) { next(error); }
});