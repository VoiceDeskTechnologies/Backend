import { Router } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { getSupabaseAdmin } from "../services/supabase.js";
import { getEntitlement } from "../services/billing/EntitlementService.js";
import { TwilioProvider, TwilioProviderError } from "../services/telephony/TwilioProvider.js";
import { config } from "../config.js";
import { z } from "zod";
import { isAdministrator } from "../middleware/admin.js";
import { reserveCallMinutes, reconcileCallMinutes } from "../services/billing/UsageService.js";

export const callsRouter = Router();
const startCallInput = z.object({
  toNumber: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{6,14}$/, "Destination must be an E.164 phone number"),
  agentId: z.string().uuid().nullable().default(null),
  taskId: z.string().uuid().nullable().default(null),
  objective: z.string().trim().max(2000).nullable().default(null),
});
callsRouter.post("/", async (request: AuthenticatedRequest, response, next) => {
  const parsed = startCallInput.safeParse(request.body);
  if (!parsed.success)
    return response.status(400).json({ error: "Enter a valid E.164 number, such as +14155550123", fields: parsed.error.flatten().fieldErrors });
  try {
    const entitlement = await getEntitlement(request.userId!);
    const administrator = await isAdministrator(
      request.userId!,
      request.userEmail,
    );
    if (
      !administrator &&
      (entitlement.accountStatus !== "active" || !entitlement.canCall)
    )
      return response.status(402).json({
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
    const ownedTask = parsed.data.taskId
      ? await database.from("call_tasks").select("id,objective,agent_id").eq("id", parsed.data.taskId).eq("user_id", request.userId).maybeSingle()
      : { data: null, error: null };
    if (ownedTask.error) throw ownedTask.error;
    if (parsed.data.taskId && !ownedTask.data) return response.status(400).json({ error: "That call task is not available" });
    if (!config.PUBLIC_URL || !config.TWILIO_ACCOUNT_SID || !config.TWILIO_AUTH_TOKEN)
      return response
        .status(503)
        .json({ error: "Twilio calling is not fully configured" });
    const assignedNumber = await database
      .from("phone_numbers")
      .select("id,phone_number")
      .eq("user_id", request.userId)
      .eq("provisioning_status", "active")
      .eq("status", "active")
      .order("is_default", { ascending: false })
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (assignedNumber.error) throw assignedNumber.error;
    if (!assignedNumber.data)
      return response.status(409).json({
        error: "No HANDSFREE number is currently assigned to your account.",
      });
    const reservationMinutes = Math.max(1, Number(entitlement.plan?.plans.max_call_duration_minutes ?? 5));
    console.info(JSON.stringify({
      event: "outbound_call_started",
      userId: request.userId,
      phoneNumberId: assignedNumber.data.id,
      provider: "twilio",
    }));
    const created = await database
      .from("calls")
      .insert({
        user_id: request.userId,
        agent_id: parsed.data.agentId,
        task_id: parsed.data.taskId,
        phone_number_id: assignedNumber.data.id,
        provider: "twilio",
        from_number: assignedNumber.data.phone_number,
        to_number: parsed.data.toNumber,
        direction: "outbound",
        objective: parsed.data.objective ?? ownedTask.data?.objective ?? null,
        status: "queued",
      })
      .select()
      .single();
    if (created.error) throw created.error;
    if (!administrator && !(await reserveCallMinutes(request.userId!, created.data.id, reservationMinutes))) {
      await database.from("calls").update({ status: "failed", failure_reason: "INSUFFICIENT_MINUTES" }).eq("id", created.data.id);
      return response.status(402).json({ error: "You do not have enough minutes for the maximum call duration." });
    }
    try {
      const result = await new TwilioProvider().startOutboundCall({
        to: parsed.data.toNumber,
        from: assignedNumber.data.phone_number,
        answerUrl: `${config.PUBLIC_URL}/api/telephony/twilio/answer/${created.data.id}`,
        statusCallbackUrl: `${config.PUBLIC_URL}/api/telephony/twilio/status`,
        mediaStreamUrl: `${(config.PUBLIC_WS_URL ?? config.PUBLIC_URL.replace(/^http/, "ws"))}/api/telephony/twilio/media-stream`,
        maxDurationSeconds: reservationMinutes * 60,
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
      if (!administrator) await reconcileCallMinutes(created.data.id, 0).catch(() => undefined);
      await database
        .from("calls")
        .update({ status: "failed" })
        .eq("id", created.data.id);
      console.error(JSON.stringify({
        event: "outbound_call_failed",
        userId: request.userId,
        phoneNumberId: assignedNumber.data.id,
        provider: "twilio",
        errorCode: error instanceof Error ? error.name : "UNKNOWN_ERROR",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      }));
      if (error instanceof TwilioProviderError)
        return response.status(403).json({
          error: error.message,
          code: error.code,
        });
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
      const administrator = await isAdministrator(
        request.userId!,
        request.userEmail,
      );
      if (entitlement.accountStatus !== "active")
        return response
          .status(403)
          .json({ error: "Your account is not active." });
      if (!administrator && !entitlement.canCall)
        return response.status(402).json({
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
