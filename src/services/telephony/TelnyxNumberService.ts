import { config } from "../../config.js";
import { getSupabaseAdmin } from "../supabase.js";

const telnyxBaseUrl = "https://api.telnyx.com/v2";
type TelnyxNumber = {
  id?: string;
  phone_number?: string;
  record_type?: string;
  country_code?: string;
  phone_number_type?: string;
};
type TelnyxResponse<T> = { data?: T; errors?: Array<{ detail?: string }> };

async function telnyxRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!config.TELNYX_API_KEY || !config.TELNYX_CONNECTION_ID)
    throw new Error("Telnyx number provisioning is not configured");
  const response = await fetch(`${telnyxBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.TELNYX_API_KEY}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const body = (await response.json()) as TelnyxResponse<T>;
  if (!response.ok || body.data === undefined)
    throw new Error(
      body.errors?.[0]?.detail ?? "Telnyx number provisioning failed",
    );
  return body.data;
}

export async function ensureNumberForUser(userId: string) {
  const database = getSupabaseAdmin();
  const existing = await database
    .from("phone_numbers")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", "telnyx")
    .eq("status", "active")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return { number: existing.data, created: false };
  const available = await telnyxRequest<TelnyxNumber[]>(
    `/available_phone_numbers?filter[phone_number_type]=local&filter[country_code]=${encodeURIComponent(config.TELNYX_DEFAULT_COUNTRY)}&page[size]=1`,
  );
  const candidate = available[0];
  if (!candidate?.id || !candidate.phone_number)
    throw new Error(
      "Telnyx has no available numbers for automatic provisioning",
    );
  const order = await telnyxRequest<{
    id?: string;
    phone_numbers?: TelnyxNumber[];
  }>("/number_orders", {
    method: "POST",
    body: JSON.stringify({
      connection_id: config.TELNYX_CONNECTION_ID,
      phone_numbers: [{ phone_number: candidate.phone_number }],
    }),
  });
  const purchased =
    order.phone_numbers?.find(
      (item) => item.phone_number === candidate.phone_number,
    ) ?? candidate;
  const inserted = await database
    .from("phone_numbers")
    .insert({
      user_id: userId,
      phone_number: purchased.phone_number,
      provider: "telnyx",
      provider_number_id: purchased.id ?? candidate.id,
      country: purchased.country_code ?? config.TELNYX_DEFAULT_COUNTRY,
      status: "active",
      capabilities: { voice: true },
    })
    .select()
    .single();
  if (inserted.error) {
    if (inserted.error.code === "23505") {
      const retry = await database
        .from("phone_numbers")
        .select("*")
        .eq("user_id", userId)
        .eq("provider", "telnyx")
        .eq("status", "active")
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (retry.error || !retry.data) throw retry.error ?? inserted.error;
      return { number: retry.data, created: false };
    }
    throw inserted.error;
  }
  return { number: inserted.data, created: true };
}
