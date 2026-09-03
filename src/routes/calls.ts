import { Router } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { getSupabaseAdmin } from "../services/supabase.js";
import { getEntitlement } from "../services/billing/EntitlementService.js";
import { TelnyxTelephonyService } from "../services/telephony/TelephonyService.js";
import { config } from "../config.js";
import { z } from "zod";

export const callsRouter = Router();
const startCallInput = z.object({
  toNumber: z.string().trim().min(7).max(30),
  agentId: z.string().uuid().nullable().default(null),
});
callsRouter.post("/", async (request: AuthenticatedRequest, response, next) => {
  const parsed = startCallInput.safeParse(request.body);
  if (!parsed.success)
    return response.status(400).json({ error: "Invalid call details" });
  try {
    const entitlement = await getEntitlement(request.userId!);
    if (entitlement.accountStatus !== "active" || !entitlement.canCall)
      return response
        .status(402)
        .json({
          error: "Your account does not have available calling minutes",
        });
    const database = getSupabaseAdmin();
    const ownedAgent = parsed.data.agentId
      ? await database
          .from("ai_agents")
          .select("id")
          .eq("id", parsed.data.agentId)
          .eq("user_id", request.userId)
          .maybeSingle()
      : { data: null, error: null };
    if (ownedAgent.error) throw ownedAgent.error;
    if (parsed.data.agentId && !ownedAgent.data)
      return response
        .status(400)
        .json({ error: "That AI agent is not available" });
    if (!config.TELNYX_PHONE_NUMBER || !config.PUBLIC_URL)
      return response
        .status(503)
        .json({ error: "Telnyx calling is not fully configured" });
    const created = await database
      .from("calls")
      .insert({
        user_id: request.userId,
        agent_id: parsed.data.agentId,
        to_number: parsed.data.toNumber,
        direction: "outbound",
        status: "queued",
      })
      .select()
      .single();
    if (created.error) throw created.error;
    try {
      const result = await new TelnyxTelephonyService().startOutboundCall({
        to: parsed.data.toNumber,
        from: config.TELNYX_PHONE_NUMBER,
        callbackUrl: `${config.PUBLIC_URL}/telnyx/webhook`,
      });
      const updated = await database
        .from("calls")
        .update({
          provider_call_id: result.providerCallId,
          status: "initiating",
        })
        .eq("id", created.data.id)
        .select()
        .single();
      if (updated.error) throw updated.error;
      response.status(201).json(updated.data);
    } catch (error) {
      await database
        .from("calls")
        .update({ status: "failed" })
        .eq("id", created.data.id);
      throw error;
    }
  } catch (error) {
    next(error);
  }
});
callsRouter.post(
  "/authorize",
  async (request: AuthenticatedRequest, response, next) => {
    try {
      const entitlement = await getEntitlement(request.userId!);
      if (entitlement.accountStatus !== "active")
        return response
          .status(403)
          .json({ error: "Your account is not active." });
      if (!entitlement.canCall)
        return response
          .status(402)
          .json({
            error:
              "Your 3-day trial has ended. Choose a HandsFree plan to continue making AI calls.",
          });
      response.json({
        allowed: true,
        maxMinutes: entitlement.balances.totalMinutes,
        source:
          entitlement.balances.trialMinutes > 0
            ? "trial"
            : entitlement.balances.planMinutes > 0
              ? "plan"
              : "payg",
      });
    } catch (error) {
      next(error);
    }
  },
);
callsRouter.get("/", async (request: AuthenticatedRequest, response, next) => {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("calls")
      .select(
        "id,to_number,direction,status,duration_seconds,summary,created_at,ai_agents(name)",
      )
      .eq("user_id", request.userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    response.json(data);
  } catch (error) {
    next(error);
  }
});
