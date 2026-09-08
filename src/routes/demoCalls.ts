import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { getSupabaseAdmin } from "../services/supabase.js";
import { TwilioProvider } from "../services/telephony/TwilioProvider.js";

const demoCallInput = z.object({
  agentType: z.enum(["sales", "customer_service", "booking", "receptionist", "lead_qualification", "support", "custom"]),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phoneNumber: z.string().trim().regex(/^\+[1-9]\d{6,14}$/, "Enter a valid E.164 phone number"),
});

export const demoCallsRouter = Router();

demoCallsRouter.post("/", async (request, response, next) => {
  const parsed = demoCallInput.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: "Enter your name, a valid phone number, and an agent type.", fields: parsed.error.flatten().fieldErrors });
  if (!config.DEMO_USER_ID) return response.status(503).json({ error: "Demo calling is not configured yet." });
  try {
    const database = getSupabaseAdmin();
    const [number, agent] = await Promise.all([
      database.from("phone_numbers").select("id,phone_number").eq("user_id", config.DEMO_USER_ID).eq("provisioning_status", "active").eq("status", "active").order("is_default", { ascending: false }).order("created_at").limit(1).maybeSingle(),
      database.from("ai_agents").select("id").eq("user_id", config.DEMO_USER_ID).eq("agent_type", parsed.data.agentType).eq("status", "active").order("created_at").limit(1).maybeSingle(),
    ]);
    if (number.error || agent.error) throw number.error ?? agent.error;
    if (!number.data || !agent.data) return response.status(503).json({ error: "This demo agent is not available yet." });
    if (!config.PUBLIC_URL || !config.TWILIO_ACCOUNT_SID || !config.TWILIO_AUTH_TOKEN) return response.status(503).json({ error: "Demo calling is not fully configured yet." });
    const created = await database.from("calls").insert({ user_id: config.DEMO_USER_ID, agent_id: agent.data.id, phone_number_id: number.data.id, provider: "twilio", from_number: number.data.phone_number, to_number: parsed.data.phoneNumber, direction: "outbound", objective: `Demo call with ${parsed.data.firstName} ${parsed.data.lastName}. Introduce yourself as a HANDSFREE ${parsed.data.agentType.replaceAll("_", " ")} and demonstrate the selected role naturally.`, status: "queued" }).select("id").single();
    if (created.error) throw created.error;
    try {
      const result = await new TwilioProvider().startOutboundCall({ to: parsed.data.phoneNumber, from: number.data.phone_number, answerUrl: `${config.PUBLIC_URL}/api/telephony/twilio/answer/${created.data.id}`, statusCallbackUrl: `${config.PUBLIC_URL}/api/telephony/twilio/status`, mediaStreamUrl: `${(config.PUBLIC_WS_URL ?? config.PUBLIC_URL.replace(/^http/, "ws"))}/api/telephony/twilio/media-stream`, maxDurationSeconds: 30 });
      const updated = await database.from("calls").update({ provider_call_id: result.providerCallId, status: "initiating" }).eq("id", created.data.id).select("id,status").single();
      if (updated.error) throw updated.error;
      response.status(201).json(updated.data);
    } catch (error) {
      await database.from("calls").update({ status: "failed" }).eq("id", created.data.id);
      throw error;
    }
  } catch (error) { next(error); }
});

demoCallsRouter.post("/:id/end", async (request, response, next) => {
  try {
    if (!config.DEMO_USER_ID) return response.status(503).json({ error: "Demo calling is not configured yet." });
    const database = getSupabaseAdmin();
    const call = await database.from("calls").select("id,provider_call_id,status").eq("id", request.params.id).eq("user_id", config.DEMO_USER_ID).maybeSingle();
    if (call.error) throw call.error;
    if (!call.data) return response.status(404).json({ error: "Demo call not found" });
    if (call.data.provider_call_id && !["completed", "failed", "cancelled", "busy", "no_answer"].includes(call.data.status)) await new TwilioProvider().endOutboundCall(call.data.provider_call_id);
    await database.from("calls").update({ status: "completed", ended_at: new Date().toISOString() }).eq("id", call.data.id);
    response.status(204).send();
  } catch (error) { next(error); }
});