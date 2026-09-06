import { getSupabaseAdmin } from "../supabase.js";
import { getEntitlement } from "../billing/EntitlementService.js";
import { isAdministrator } from "../../middleware/admin.js";
import { reserveCallMinutes, reconcileCallMinutes } from "../billing/UsageService.js";
import { TwilioProvider } from "../telephony/TwilioProvider.js";
import { config } from "../../config.js";

const workerBatchSize = 10;

function callbackUrl(path: string) {
  if (!config.PUBLIC_URL) throw new Error("PUBLIC_URL is required for scheduled calls");
  return `${config.PUBLIC_URL}${path}`;
}

function mediaStreamUrl() {
  const base = config.PUBLIC_WS_URL ?? config.PUBLIC_URL?.replace(/^http/, "ws");
  if (!base) throw new Error("PUBLIC_WS_URL or PUBLIC_URL is required for scheduled calls");
  return `${base.replace(/\/$/, "")}/api/telephony/twilio/media-stream`;
}

async function failTask(task: { id: string; retry_count: number; max_attempts: number }, message: string, retryable: boolean) {
  const retry = retryable && task.retry_count < task.max_attempts;
  const nextAttempt = new Date(Date.now() + Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.max(task.retry_count - 1, 0))).toISOString();
  await getSupabaseAdmin().from("call_tasks").update({
    status: retry ? "scheduled" : "failed",
    scheduled_at: retry ? nextAttempt : null,
    last_error: message.slice(0, 1000),
    updated_at: new Date().toISOString(),
  }).eq("id", task.id);
}

async function processTask(task: { id: string; user_id: string; phone_number: string; objective: string; agent_id: string | null; maximum_duration_minutes: number; retry_count: number; max_attempts: number }) {
  const database = getSupabaseAdmin();
  const profile = await database.from("profiles").select("status").eq("id", task.user_id).single();
  if (profile.error) throw profile.error;
  if (profile.data.status !== "active") return failTask(task, "Account is not active", false);
  if (!/^\+[1-9]\d{6,14}$/.test(task.phone_number)) return failTask(task, "Task destination is not a valid E.164 number", false);

  let agentId = task.agent_id;
  if (agentId) {
    const agent = await database.from("ai_agents").select("id").eq("id", agentId).eq("user_id", task.user_id).eq("status", "active").maybeSingle();
    if (agent.error) throw agent.error;
    if (!agent.data) return failTask(task, "Assigned AI agent is unavailable", false);
  } else {
    const agent = await database.from("ai_agents").select("id").eq("user_id", task.user_id).eq("status", "active").order("created_at").limit(1).maybeSingle();
    if (agent.error) throw agent.error;
    agentId = agent.data?.id ?? null;
  }

  const number = await database.from("phone_numbers").select("id,phone_number").eq("user_id", task.user_id).eq("status", "active").eq("provisioning_status", "active").order("is_default", { ascending: false }).order("created_at").limit(1).maybeSingle();
  if (number.error) throw number.error;
  if (!number.data) return failTask(task, "No active HANDSFREE number is assigned", true);

  const entitlement = await getEntitlement(task.user_id);
  const administrator = await isAdministrator(task.user_id);
  if (!administrator && (entitlement.accountStatus !== "active" || !entitlement.canCall)) return failTask(task, "No calling minutes are available", false);
  const reservationMinutes = Math.max(1, task.maximum_duration_minutes);
  const call = await database.from("calls").insert({
    user_id: task.user_id, agent_id: agentId, task_id: task.id, phone_number_id: number.data.id,
    provider: "twilio", from_number: number.data.phone_number, to_number: task.phone_number,
    direction: "outbound", objective: task.objective, status: "queued",
  }).select("id").single();
  if (call.error) throw call.error;
  if (!administrator && !(await reserveCallMinutes(task.user_id, call.data.id, reservationMinutes))) {
    await database.from("calls").update({ status: "failed", failure_reason: "INSUFFICIENT_MINUTES" }).eq("id", call.data.id);
    return failTask(task, "Insufficient calling minutes", false);
  }

  try {
    const result = await new TwilioProvider().startOutboundCall({
      to: task.phone_number,
      from: number.data.phone_number,
      answerUrl: callbackUrl(`/api/telephony/twilio/answer/${call.data.id}`),
      statusCallbackUrl: callbackUrl("/api/telephony/twilio/status"),
      mediaStreamUrl: mediaStreamUrl(),
      maxDurationSeconds: reservationMinutes * 60,
    });
    const updated = await database.from("calls").update({ provider_call_id: result.providerCallId, agent_id: agentId, status: "initiating" }).eq("id", call.data.id);
    if (updated.error) throw updated.error;
    await database.from("call_tasks").update({ status: "in_progress", updated_at: new Date().toISOString() }).eq("id", task.id);
  } catch (error) {
    if (!administrator) await reconcileCallMinutes(call.data.id, 0).catch(() => undefined);
    await database.from("calls").update({ status: "failed", failure_reason: error instanceof Error ? error.message : "Scheduled call failed" }).eq("id", call.data.id);
    await failTask(task, error instanceof Error ? error.message : "Scheduled call failed", true);
  }
}

export async function processDueTasks() {
  const database = getSupabaseAdmin();
  const due = await database.from("call_tasks").select("id,user_id,phone_number,objective,agent_id,maximum_duration_minutes,retry_count,max_attempts").eq("status", "scheduled").lte("scheduled_at", new Date().toISOString()).order("scheduled_at").limit(workerBatchSize);
  if (due.error) throw due.error;
  for (const task of due.data ?? []) {
    const claimed = await database.from("call_tasks").update({ status: "calling", retry_count: task.retry_count + 1, started_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", task.id).eq("status", "scheduled").select("id").maybeSingle();
    if (claimed.error || !claimed.data) continue;
    await processTask({ ...task, retry_count: task.retry_count + 1 }).catch((error: Error) => failTask({ ...task, retry_count: task.retry_count + 1 }, error.message, true).catch(() => undefined));
  }
}