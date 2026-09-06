import { getSupabaseAdmin } from "../supabase.js";

export async function reserveCallMinutes(userId: string, callId: string, minutes: number) {
  const { data, error } = await getSupabaseAdmin().rpc("reserve_call_minutes", { p_user_id: userId, p_call_id: callId, p_minutes: minutes });
  if (error) throw error;
  return data === true;
}

export async function reconcileCallMinutes(callId: string, durationSeconds: number) {
  const { data, error } = await getSupabaseAdmin().rpc("reconcile_call_minutes", { p_call_id: callId, p_duration_seconds: durationSeconds });
  if (error) throw error;
  return data === true;
}