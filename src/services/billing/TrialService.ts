import { getSupabaseAdmin } from "../supabase.js";

export async function getOrCreateTrial(userId: string) {
  const database = getSupabaseAdmin();
  const { data: existing, error } = await database.from("trial_accounts").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (existing) return refreshTrial(existing);
  const { data: settings, error: settingsError } = await database.from("billing_settings").select("trial_enabled,trial_duration_days,trial_minutes").eq("id", true).single();
  if (settingsError) throw settingsError;
  if (!settings.trial_enabled) return null;
  const started = new Date();
  const expires = new Date(started.getTime() + Number(settings.trial_duration_days) * 86400000);
  const { data, error: insertError } = await database.from("trial_accounts").insert({ user_id: userId, trial_started_at: started.toISOString(), trial_expires_at: expires.toISOString(), trial_minutes_granted: settings.trial_minutes, trial_minutes_remaining: settings.trial_minutes }).select().single();
  if (insertError) throw insertError;
  return data;
}

async function refreshTrial(trial: Record<string, unknown>) {
  if (trial.trial_status === "active" && new Date(String(trial.trial_expires_at)) <= new Date()) {
    const { data, error } = await getSupabaseAdmin().from("trial_accounts").update({ trial_status: "expired", updated_at: new Date().toISOString() }).eq("id", trial.id).select().single();
    if (error) throw error;
    return data;
  }
  return trial;
}