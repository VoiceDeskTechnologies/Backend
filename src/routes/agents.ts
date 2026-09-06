import { Router } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { getSupabaseAdmin } from "../services/supabase.js";

const agentInput = z.object({ name: z.string().trim().min(1).max(80), role: z.string().trim().min(1).max(120), personality: z.string().trim().min(1).max(500), greeting: z.string().trim().min(1).max(500), systemInstructions: z.string().trim().min(1).max(4000), disclosureEnabled: z.boolean().default(true), disclosureText: z.string().trim().max(500).nullable().default(null) });
const agentUpdate = agentInput.partial().extend({ status: z.enum(["active", "disabled"]).optional() });
export const agentsRouter = Router();

agentsRouter.get("/", async (request: AuthenticatedRequest, response, next) => {
  try { const { data, error } = await getSupabaseAdmin().from("ai_agents").select("*").eq("user_id", request.userId).order("created_at", { ascending: false }); if (error) throw error; response.json(data); } catch (error) { next(error); }
});
agentsRouter.post("/", async (request: AuthenticatedRequest, response, next) => {
  const parsed = agentInput.safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: "Invalid agent details", fields: parsed.error.flatten().fieldErrors });
  try { const input = parsed.data; const { data, error } = await getSupabaseAdmin().from("ai_agents").insert({ user_id: request.userId, name: input.name, role: input.role, personality: input.personality, greeting: input.greeting, system_instructions: input.systemInstructions, disclosure_enabled: input.disclosureEnabled, disclosure_text: input.disclosureText }).select().single(); if (error) throw error; response.status(201).json(data); } catch (error) { next(error); }
});
agentsRouter.patch("/:id", async (request: AuthenticatedRequest, response, next) => {

  const parsed = agentUpdate.safeParse(request.body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) return response.status(400).json({ error: "Invalid agent update", fields: parsed.success ? {} : parsed.error.flatten().fieldErrors });
  try {
    const input = parsed.data;
    const update = { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.role !== undefined ? { role: input.role } : {}), ...(input.personality !== undefined ? { personality: input.personality } : {}), ...(input.greeting !== undefined ? { greeting: input.greeting, disclosure_text: input.greeting } : {}), ...(input.systemInstructions !== undefined ? { system_instructions: input.systemInstructions } : {}), ...(input.disclosureEnabled !== undefined ? { disclosure_enabled: input.disclosureEnabled } : {}), ...(input.disclosureText !== undefined ? { disclosure_text: input.disclosureText } : {}), ...(input.status !== undefined ? { status: input.status } : {}), updated_at: new Date().toISOString() };
    const { data, error } = await getSupabaseAdmin().from("ai_agents").update(update).eq("id", request.params.id).eq("user_id", request.userId).select().single();
    if (error) throw error;
    response.json(data);
  } catch (error) { next(error); }
});
agentsRouter.delete("/:id", async (request: AuthenticatedRequest, response, next) => {
  try { const { error } = await getSupabaseAdmin().from("ai_agents").delete().eq("id", request.params.id).eq("user_id", request.userId); if (error) throw error; response.status(204).send(); } catch (error) { next(error); }
});