import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "./auth.js";
import { getSupabaseAdmin } from "../services/supabase.js";
import { config } from "../config.js";

export type AdminRequest = AuthenticatedRequest & { adminRole?: string };

export async function requireAdmin(request: AdminRequest, response: Response, next: NextFunction) {
  if (!request.userId) return response.status(401).json({ error: "Authentication required" });
  if (request.userEmail && config.ADMIN_EMAILS.includes(request.userEmail)) {
    request.adminRole = "super_administrator";
    return next();
  }
  const { data, error } = await getSupabaseAdmin().from("admin_users").select("role").eq("user_id", request.userId).eq("active", true).maybeSingle();
  if (error) return next(error);
  if (!data) return response.status(403).json({ error: "Administrator access required" });
  request.adminRole = data.role;
  next();
}