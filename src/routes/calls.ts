import { Router } from "express";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { getSupabaseAdmin } from "../services/supabase.js";
import { getEntitlement } from "../services/billing/EntitlementService.js";
import { TelnyxTelephonyService, TelnyxTelephonyError } from "../services/telephony/TelephonyService.js";
import { config } from "../config.js";
import { z } from "zod";
import { isAdministrator } from "../middleware/admin.js";

export const callsRouter = Router();
const startCallInput = z.object({
  toNumber: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{6,14}$/, "Destination must be an E.164 phone number"),
  agentId: z.string().uuid().nullable().default(null),
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
    if (!config.PUBLIC_URL || !config.TELNYX_CONNECTION_ID)
      return response
        .status(503)
        .json({ error: "Telnyx calling is not fully configured" });
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
    console.info(JSON.stringify({
      event: "outbound_call_started",
      userId: request.userId,
      phoneNumberId: assignedNumber.data.id,
      provider: "telnyx",
    }));
    const created = await database
      .from("calls")
      .insert({
        user_id: request.userId,
        agent_id: parsed.data.agentId,
        phone_number_id: assignedNumber.data.id,
        provider: "telnyx",
        from_number: assignedNumber.data.phone_number,
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
        from: assignedNumber.data.phone_number,
        callbackUrl: `${config.PUBLIC_URL}/api/webhooks/telnyx`,
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
      console.error(JSON.stringify({
        event: "outbound_call_failed",
        userId: request.userId,
        phoneNumberId: assignedNumber.data.id,
        provider: "telnyx",
        errorCode: error instanceof Error ? error.name : "UNKNOWN_ERROR",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      }));
      if (error instanceof TelnyxTelephonyError && error.code === "TELNYX_DESTINATION_NOT_ALLOWED")
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
