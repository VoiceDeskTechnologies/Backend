import { Router } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { getSupabaseAdmin } from "../services/supabase.js";
import { getEntitlement } from "../services/billing/EntitlementService.js";

export const callsRouter = Router();
callsRouter.post("/authorize", async (request: AuthenticatedRequest, response, next) => { try { const entitlement = await getEntitlement(request.userId!); if (entitlement.accountStatus !== "active") return response.status(403).json({ error: "Your account is not active." }); if (!entitlement.canCall) return response.status(402).json({ error: "Your 3-day trial has ended. Choose a HandsFree plan to continue making AI calls." }); response.json({ allowed: true, maxMinutes: entitlement.balances.totalMinutes, source: entitlement.balances.trialMinutes > 0 ? "trial" : entitlement.balances.planMinutes > 0 ? "plan" : "payg" }); } catch (error) { next(error); } });
callsRouter.get("/", async (request: AuthenticatedRequest, response, next) => { try { const { data, error } = await getSupabaseAdmin().from("calls").select("id,to_number,direction,status,duration_seconds,summary,created_at,ai_agents(name)").eq("user_id", request.userId).order("created_at", { ascending: false }).limit(100); if (error) throw error; response.json(data); } catch (error) { next(error); } });