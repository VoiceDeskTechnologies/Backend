import { getSupabaseAdmin } from "./supabase.js";

export async function calculatePaygPrice(minutes: number) {
  const database = getSupabaseAdmin();
  const { data: settings, error: settingsError } = await database.from("billing_settings").select("payg_price_per_minute,custom_payg_max_minutes").eq("id", true).single();
  if (settingsError) throw settingsError;
  if (!Number.isInteger(minutes) || minutes < 25 || minutes > settings.custom_payg_max_minutes) throw new Error(`Choose between 25 and ${settings.custom_payg_max_minutes} minutes`);
  const { data: packages, error } = await database.from("payg_packages").select("minutes,price,product_id").eq("active", true).order("minutes");
  if (error) throw error;
  const tier = [...(packages ?? [])].reverse().find((item) => minutes >= item.minutes);
  const rate = tier ? Number(tier.price) / tier.minutes : Number(settings.payg_price_per_minute);
  return { allowed: true, minutes, price: Number((minutes * rate).toFixed(2)), currency: "USD", package: tier?.product_id ?? "CUSTOM_PAYG", rate };
}