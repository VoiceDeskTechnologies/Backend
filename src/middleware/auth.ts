import type { NextFunction, Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import { config } from "../config.js";

export type AuthenticatedRequest = Request & { userId?: string; userEmail?: string };

export async function requireAuth(request: AuthenticatedRequest, response: Response, next: NextFunction) {
  const token = request.headers.authorization?.startsWith("Bearer ") ? request.headers.authorization.slice(7) : undefined;
  if (!token) return response.status(401).json({ error: "Authentication required" });
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) return response.status(503).json({ error: "Authentication service is not configured" });
  const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return response.status(401).json({ error: "Invalid authentication token" });
  request.userId = data.user.id;
  request.userEmail = data.user.email?.toLowerCase();
  next();
}