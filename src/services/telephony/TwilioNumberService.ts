import { config } from "../../config.js";
import { getSupabaseAdmin } from "../supabase.js";
import { getEntitlement } from "../billing/EntitlementService.js";
import { TwilioProvider } from "./TwilioProvider.js";

const maxProvisioningAttempts = 5;
const provider = () => new TwilioProvider();

export type NumberSearchCriteria = { countryCode?: string; areaCode?: string };

function voiceUrl() {
  if (!config.PUBLIC_URL) throw new Error("PUBLIC_URL is required for Twilio number configuration");
  return `${config.PUBLIC_URL}/api/telephony/twilio/incoming`;
}

function statusUrl() {
  if (!config.PUBLIC_URL) throw new Error("PUBLIC_URL is required for Twilio number configuration");
  return `${config.PUBLIC_URL}/api/telephony/twilio/status`;
}

export async function searchAvailableNumbers(criteria: NumberSearchCriteria = {}) {
  return provider().searchNumbers(criteria.countryCode ?? "US", criteria.areaCode);
}

export async function listOwnedNumbers() {
  return provider().listOwnedNumbers();
}

export async function getNumber(sid: string) {
  return provider().getNumber(sid);
}

export async function releaseNumber(sid: string) {
  return provider().releaseNumber(sid);
}

async function activeNumberForUser(userId: string) {
  const { data, error } = await getSupabaseAdmin().from("phone_numbers").select("*").eq("user_id", userId).in("provisioning_status", ["active", "provisioning"]).order("created_at").limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

export async function provisionNumberForUser(userId: string, options: { paymentId?: string; areaCode?: string; idempotencyKey?: string } = {}) {
  const database = getSupabaseAdmin();
  const entitlement = await getEntitlement(userId);
  if (!entitlement.plan && entitlement.trial?.trial_status !== "active") throw new Error("An active trial or paid plan is required before provisioning a number");
  if (options.areaCode && !/^\d{3}$/.test(options.areaCode)) throw new Error("Area code must contain three digits");
  if (options.areaCode && !entitlement.plan?.plans.area_code_selection) throw new Error("Your plan does not support area-code selection");
  const existing = await activeNumberForUser(userId);
  if (existing) return { number: existing, created: false, status: existing.provisioning_status };
  const idempotencyKey = options.idempotencyKey ?? `user:${userId}:area:${options.areaCode ?? "auto"}`;
  await database.from("phone_number_provisioning_jobs").upsert({ user_id: userId, payment_id: options.paymentId ?? null, idempotency_key: idempotencyKey, status: "pending", updated_at: new Date().toISOString() }, { onConflict: "idempotency_key", ignoreDuplicates: true });
  const { data: job, error: jobError } = await database.from("phone_number_provisioning_jobs").select("*").eq("idempotency_key", idempotencyKey).single();
  if (jobError) throw jobError;
  if (job.status === "active" || job.status === "provisioning") return { number: await activeNumberForUser(userId), created: false, status: job.status };
  if (job.attempt_count >= maxProvisioningAttempts) throw new Error("Number provisioning has reached its retry limit");
  await database.from("phone_number_provisioning_jobs").update({ status: "provisioning", attempt_count: job.attempt_count + 1, error_message: null, updated_at: new Date().toISOString() }).eq("id", job.id);
  try {
    const candidate = (await searchAvailableNumbers({ areaCode: options.areaCode }))[0];
    if (!candidate?.phoneNumber) throw new Error("No Twilio numbers are currently available");
    const purchased = await provider().provisionNumber(candidate.phoneNumber, voiceUrl(), statusUrl());
    const defaultNumber = !(await database.from("phone_numbers").select("id").eq("user_id", userId).eq("is_default", true).eq("provisioning_status", "active").limit(1).maybeSingle()).data;
    const inserted = await database.from("phone_numbers").insert({
      user_id: userId, phone_number: purchased.phoneNumber, provider: "twilio", provider_number_id: purchased.sid,
      twilio_phone_number_sid: purchased.sid, country: "US", country_code: "US",
      area_code: purchased.phoneNumber.match(/^\+1(\d{3})/)?.[1] ?? options.areaCode ?? null, status: "active", provisioning_status: "active",
      is_default: defaultNumber, assigned_at: new Date().toISOString(), capabilities: { voice: true },
    }).select().single();
    if (inserted.error) throw inserted.error;
    await database.from("phone_number_provisioning_jobs").update({ status: "active", twilio_phone_number_sid: purchased.sid, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", job.id);
    return { number: inserted.data, created: true, status: "active" };
  } catch (error) {
    await database.from("phone_number_provisioning_jobs").update({ status: "failed", error_message: error instanceof Error ? error.message : "Provisioning failed", next_attempt_at: new Date(Date.now() + 120000).toISOString(), updated_at: new Date().toISOString() }).eq("id", job.id);
    throw error;
  }
}

export const ensureNumberForUser = provisionNumberForUser;

export async function retryDueProvisioningJobs() {
  const { data: jobs, error } = await getSupabaseAdmin().from("phone_number_provisioning_jobs").select("user_id,idempotency_key").eq("status", "failed").lte("next_attempt_at", new Date().toISOString()).limit(10);
  if (error) throw error;
  for (const job of jobs ?? []) await provisionNumberForUser(job.user_id, { idempotencyKey: job.idempotency_key }).catch(() => undefined);
}