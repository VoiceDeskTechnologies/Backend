import { getSupabaseAdmin } from "../supabase.js";
import { getOrCreateTrial } from "./TrialService.js";

export async function getEntitlement(userId: string) {
  const database = getSupabaseAdmin();
  const [trial, period, balance, profile] = await Promise.all([
    getOrCreateTrial(userId),
    database.from("plan_periods").select("*,plans(*)").eq("user_id", userId).eq("status", "active").gt("period_end", new Date().toISOString()).order("period_end", { ascending: false }).limit(1).maybeSingle(),
    database.from("usage_balances").select("monthly_remaining,payg_remaining").eq("user_id", userId).maybeSingle(),
    database.from("profiles").select("status").eq("id", userId).single(),
  ]);
  if (period.error || balance.error || profile.error) throw period.error ?? balance.error ?? profile.error;
  const trialMinutes = trial?.trial_status === "active" ? Number(trial.trial_minutes_remaining) : 0;
  const planMinutes = Number(balance.data?.monthly_remaining ?? 0);
  const paygMinutes = Number(balance.data?.payg_remaining ?? 0);
  return { accountStatus: profile.data.status, trial, plan: period.data, balances: { trialMinutes, planMinutes, paygMinutes, totalMinutes: trialMinutes + planMinutes + paygMinutes }, canCall: profile.data.status === "active" && trialMinutes + planMinutes + paygMinutes > 0 };
}