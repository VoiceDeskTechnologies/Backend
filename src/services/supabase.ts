import { createClient } from "@supabase/supabase-js";
import { config } from "../config.js";

export function getSupabaseAdmin() {
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Database service is not configured");
  return createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}