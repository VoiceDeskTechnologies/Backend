import { config } from "../../config.js";
import { getSupabaseAdmin } from "../supabase.js";
import { getEntitlement } from "../billing/EntitlementService.js";

const telnyxBaseUrl = "https://api.telnyx.com/v2";
const maxProvisioningAttempts = 5;

export type TelnyxNumber = {
  id?: string;
  phone_number?: string;
  record_type?: string;
  country_code?: string;
  phone_number_type?: string;
  connection_id?: string;
  status?: string;
  features?: Record<string, unknown>;
};

export type NumberSearchCriteria = {
  countryCode?: string;
  areaCode?: string;
};

export class TelnyxNumberError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly providerStatus?: number,
    readonly providerRequestId?: string,
  ) {
    super(message);
    this.name = "TelnyxNumberError";
  }
}

type TelnyxResponse<T> = {
  data?: T;
  errors?: Array<{ code?: string; detail?: string; title?: string }>;
};

async function telnyxRequest<T>(path: string, init: RequestInit = {}) {
  if (!config.TELNYX_API_KEY || !config.TELNYX_CONNECTION_ID)
    throw new TelnyxNumberError(
      "Telnyx number provisioning is not configured",
      "TELNYX_CONFIGURATION_ERROR",
    );
  let response: Response;
  try {
    response = await fetch(`${telnyxBaseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${config.TELNYX_API_KEY}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  } catch {
    throw new TelnyxNumberError(
      "Unable to connect to Telnyx",
      "TELNYX_CONNECTION_ERROR",
    );
  }
  const body = (await response.json().catch(() => null)) as TelnyxResponse<T> | null;
  if (!response.ok || body?.data === undefined) {
    const providerError = body?.errors?.[0];
    const code = providerError?.code ??
      (response.status === 401 || response.status === 403
        ? "TELNYX_AUTHENTICATION_ERROR"
        : response.status === 404
          ? "TELNYX_NUMBER_NOT_FOUND"
          : "TELNYX_PROVIDER_ERROR");
    throw new TelnyxNumberError(
      providerError?.detail ?? "Telnyx number operation failed",
      code,
      response.status,
      response.headers.get("x-request-id") ?? undefined,
    );
  }
  return body.data;
}

export async function searchAvailableNumbers(criteria: NumberSearchCriteria = {}) {
  const countryCode = criteria.countryCode ?? config.TELNYX_DEFAULT_COUNTRY;
  const areaFilter = criteria.areaCode
    ? `&filter[national_destination_code]=${encodeURIComponent(criteria.areaCode)}`
    : "";
  const available = await telnyxRequest<TelnyxNumber[]>(
    `/available_phone_numbers?filter[phone_number_type]=local&filter[country_code]=${encodeURIComponent(countryCode)}${areaFilter}&page[size]=10`,
  );
  return available.filter((number) => number.phone_number && number.id);
}

export async function purchaseNumber(phoneNumber: string) {
  const order = await telnyxRequest<{
    id?: string;
    phone_numbers?: TelnyxNumber[];
  }>("/number_orders", {
    method: "POST",
    body: JSON.stringify({
      connection_id: config.TELNYX_CONNECTION_ID,
      phone_numbers: [{ phone_number: phoneNumber }],
    }),
  });
  const purchased = order.phone_numbers?.find(
    (number) => number.phone_number === phoneNumber,
  );
  if (!purchased?.id || !purchased.phone_number)
    throw new TelnyxNumberError(
      "Telnyx did not return the purchased number",
      "TELNYX_NUMBER_UNAVAILABLE",
    );
  return purchased;
}

export async function getNumber(telnyxPhoneNumberId: string) {
  return telnyxRequest<TelnyxNumber>(
    `/phone_numbers/${encodeURIComponent(telnyxPhoneNumberId)}`,
  );
}

export async function configureNumber(telnyxPhoneNumberId: string) {
  const configured = await telnyxRequest<TelnyxNumber>(
    `/phone_numbers/${encodeURIComponent(telnyxPhoneNumberId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ connection_id: config.TELNYX_CONNECTION_ID }),
    },
  );
  if (
    configured.connection_id &&
    configured.connection_id !== config.TELNYX_CONNECTION_ID
  )
    throw new TelnyxNumberError(
      "Telnyx returned an unexpected voice connection",
      "TELNYX_CONFIGURATION_ERROR",
    );
  return configured;
}

export async function listOwnedNumbers() {
  return telnyxRequest<TelnyxNumber[]>(
    "/phone_numbers?page[size]=100",
  );
}

export async function claimConfiguredNumberForUser(userId: string) {
  if (!config.TELNYX_PHONE_NUMBER)
    throw new TelnyxNumberError(
      "TELNYX_PHONE_NUMBER is not configured",
      "TELNYX_CONFIGURATION_ERROR",
    );
  const database = getSupabaseAdmin();
  const existing = await activeNumberForUser(userId);
  if (existing) return { number: existing, created: false, status: existing.provisioning_status };
  const ownedNumbers = await listOwnedNumbers();
  const configuredPhoneNumber = config.TELNYX_PHONE_NUMBER.trim();
  const owned = ownedNumbers.find((number) => number.phone_number === configuredPhoneNumber);
  if (!owned?.id || !owned.phone_number)
    throw new TelnyxNumberError(
      "The configured Telnyx number was not found in the account inventory",
      "TELNYX_NUMBER_NOT_FOUND",
    );
  const verified = await getNumber(owned.id);
  if (!verified.phone_number || verified.phone_number !== configuredPhoneNumber)
    throw new TelnyxNumberError("Configured Telnyx number verification failed", "TELNYX_CONFIGURATION_ERROR");
  if (verified.connection_id && verified.connection_id !== config.TELNYX_CONNECTION_ID)
    throw new TelnyxNumberError("Configured number is attached to another Telnyx connection", "TELNYX_CONFIGURATION_ERROR");
  const duplicate = await database.from("phone_numbers").select("id,user_id").eq("telnyx_phone_number_id", verified.id).maybeSingle();
  if (duplicate.error) throw duplicate.error;
  if (duplicate.data && duplicate.data.user_id !== userId)
    throw new Error("The configured Telnyx number is already assigned to another user");
  if (duplicate.data) return { number: await activeNumberForUser(userId), created: false, status: "active" };
  const defaultNumber = await database.from("phone_numbers").select("id").eq("user_id", userId).eq("is_default", true).eq("provisioning_status", "active").limit(1).maybeSingle();
  if (defaultNumber.error) throw defaultNumber.error;
  const { data, error } = await database.from("phone_numbers").insert({
    user_id: userId,
    phone_number: verified.phone_number,
    provider: "telnyx",
    provider_number_id: verified.id,
    telnyx_phone_number_id: verified.id,
    connection_id: verified.connection_id ?? config.TELNYX_CONNECTION_ID,
    country: verified.country_code ?? config.TELNYX_DEFAULT_COUNTRY,
    country_code: verified.country_code ?? config.TELNYX_DEFAULT_COUNTRY,
    area_code: verified.phone_number.match(/^\+1(\d{3})/)?.[1] ?? null,
    status: "active",
    provisioning_status: "active",
    is_default: !defaultNumber.data,
    assigned_at: new Date().toISOString(),
    capabilities: verified.features ?? { voice: true },
  }).select().single();
  if (error) throw error;
  return { number: data, created: true, status: "active" };
}

export async function releaseNumber(telnyxPhoneNumberId: string) {
  return telnyxRequest<TelnyxNumber>(
    `/phone_numbers/${encodeURIComponent(telnyxPhoneNumberId)}`,
    { method: "DELETE" },
  );
}

async function activeNumberForUser(userId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("phone_numbers")
    .select("*")
    .eq("user_id", userId)
    .in("provisioning_status", ["active", "provisioning"])
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function provisionNumberForUser(
  userId: string,
  options: { paymentId?: string; areaCode?: string; idempotencyKey?: string } = {},
) {
  const database = getSupabaseAdmin();
  const { data: profile, error: profileError } = await database
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile) throw new Error("User not found");

  const { data: administrator, error: administratorError } = await database
    .from("admin_users")
    .select("user_id")
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();
  if (administratorError) throw administratorError;
  if (administrator && config.TELNYX_PHONE_NUMBER)
    return claimConfiguredNumberForUser(userId);

  const entitlement = await getEntitlement(userId);
  if (!entitlement.plan && entitlement.trial?.trial_status !== "active")
    throw new Error("An active trial or paid plan is required before provisioning a number");
  if (options.areaCode && !entitlement.plan?.plans.area_code_selection)
    throw new Error("Your plan does not support area-code selection");
  if (options.areaCode && !/^\d{3}$/.test(options.areaCode))
    throw new Error("Area code must contain three digits");

  const existing = await activeNumberForUser(userId);
  if (existing) return { number: existing, created: false, status: existing.provisioning_status };

  const idempotencyKey = options.idempotencyKey ??
    `user:${userId}:area:${options.areaCode ?? "auto"}`;
  const jobResult = await database
    .from("phone_number_provisioning_jobs")
    .upsert(
      {
        user_id: userId,
        payment_id: options.paymentId ?? null,
        idempotency_key: idempotencyKey,
        status: "pending",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "idempotency_key", ignoreDuplicates: true },
    )
    .select()
    .maybeSingle();
  if (jobResult.error) throw jobResult.error;
  const { data: job, error: jobError } = await database
    .from("phone_number_provisioning_jobs")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .single();
  if (jobError) throw jobError;
  if (job.status === "active" && job.telnyx_phone_number_id) {
    const assigned = await activeNumberForUser(userId);
    if (assigned) return { number: assigned, created: false, status: "active" };
  }
  if (job.status === "provisioning")
    return { number: null, created: false, status: "provisioning" };
  if (job.attempt_count >= maxProvisioningAttempts)
    throw new Error("Number provisioning has reached its retry limit");

  await database.from("phone_number_provisioning_jobs").update({
    status: "provisioning",
    attempt_count: job.attempt_count + 1,
    error_message: null,
    updated_at: new Date().toISOString(),
  }).eq("id", job.id);

  try {
    const candidates = await searchAvailableNumbers({ areaCode: options.areaCode });
    const candidate = candidates[0];
    if (!candidate?.phone_number)
      throw new TelnyxNumberError(
        options.areaCode
          ? "No numbers are currently available in this area code"
          : "Telnyx has no available US numbers",
        "TELNYX_NUMBER_UNAVAILABLE",
      );
    const purchased = await purchaseNumber(candidate.phone_number);
    const configured = await configureNumber(purchased.id!);
    const verified = await getNumber(purchased.id!);
    if (!verified.phone_number || (verified.connection_id && verified.connection_id !== config.TELNYX_CONNECTION_ID))
      throw new TelnyxNumberError("Telnyx number verification failed", "TELNYX_CONFIGURATION_ERROR");
    const areaCode = verified.phone_number.match(/^\+1(\d{3})/)?.[1] ?? options.areaCode ?? null;
    const defaultNumber = !(await database.from("phone_numbers").select("id").eq("user_id", userId).eq("is_default", true).eq("provisioning_status", "active").limit(1).maybeSingle()).data;
    const inserted = await database.from("phone_numbers").insert({
      user_id: userId,
      phone_number: verified.phone_number,
      provider: "telnyx",
      provider_number_id: verified.id ?? purchased.id,
      telnyx_phone_number_id: verified.id ?? purchased.id,
      connection_id: configured.connection_id ?? config.TELNYX_CONNECTION_ID,
      country: verified.country_code ?? config.TELNYX_DEFAULT_COUNTRY,
      country_code: verified.country_code ?? config.TELNYX_DEFAULT_COUNTRY,
      area_code: areaCode,
      status: "active",
      provisioning_status: "active",
      is_default: defaultNumber,
      assigned_at: new Date().toISOString(),
      capabilities: { voice: true },
    }).select().single();
    if (inserted.error) throw inserted.error;
    await database.from("phone_number_provisioning_jobs").update({
      status: "active",
      telnyx_phone_number_id: verified.id ?? purchased.id,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    return { number: inserted.data, created: true, status: "active" };
  } catch (error) {
    await database.from("phone_number_provisioning_jobs").update({
      status: "failed",
      error_message: error instanceof Error ? error.message : "Provisioning failed",
      next_attempt_at: new Date(Date.now() + 60_000 * 2 ** job.attempt_count).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", job.id);
    throw error;
  }
}

export const ensureNumberForUser = provisionNumberForUser;

export async function retryDueProvisioningJobs() {
  const { data: jobs, error } = await getSupabaseAdmin()
    .from("phone_number_provisioning_jobs")
    .select("user_id,idempotency_key")
    .eq("status", "failed")
    .lte("next_attempt_at", new Date().toISOString())
    .limit(10);
  if (error) throw error;
  for (const job of jobs ?? []) {
    try {
      await provisionNumberForUser(job.user_id, { idempotencyKey: job.idempotency_key });
    } catch (retryError) {
      console.error(JSON.stringify({
        event: "number_provisioning_retry_failed",
        userId: job.user_id,
        provisioningJobId: job.idempotency_key,
        errorCode: retryError instanceof Error ? retryError.name : "UNKNOWN_ERROR",
      }));
    }
  }
}
