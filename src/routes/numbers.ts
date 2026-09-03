import { Router } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { getSupabaseAdmin } from "../services/supabase.js";

export const numbersRouter = Router();
const updateInput = z.object({ friendlyName: z.string().trim().max(120).nullable().optional(), agentId: z.string().uuid().nullable().optional() });
numbersRouter.get("/", async (request: AuthenticatedRequest, response, next) => { try { const { data, error } = await getSupabaseAdmin().from("phone_numbers").select("*, ai_agents(name)").eq("user_id", request.userId).order("created_at", { ascending: false }); if (error) throw error; response.json(data); } catch (error) { next(error); } });
numbersRouter.patch("/:id", async (request: AuthenticatedRequest, response, next) => { const parsed = updateInput.safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: "Invalid number configuration" }); try { const input = parsed.data; if (input.agentId) { const owned = await getSupabaseAdmin().from("ai_agents").select("id").eq("id", input.agentId).eq("user_id", request.userId).maybeSingle(); if (owned.error) throw owned.error; if (!owned.data) return response.status(400).json({ error: "That agent is not available" }); } const { data, error } = await getSupabaseAdmin().from("phone_numbers").update({ ...(input.friendlyName !== undefined ? { friendly_name: input.friendlyName } : {}), ...(input.agentId !== undefined ? { agent_id: input.agentId } : {}) }).eq("id", request.params.id).eq("user_id", request.userId).select("*, ai_agents(name)").single(); if (error) throw error; response.json(data); } catch (error) { next(error); } });
