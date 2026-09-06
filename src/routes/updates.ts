import { Router } from "express";
import { z } from "zod";
import type { AdminRequest } from "../middleware/admin.js";
import { getSupabaseAdmin } from "../services/supabase.js";

const updateInput = z.object({
	title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(2000),
	type: z.enum(["maintenance", "promotion", "upgrade", "announcement"]), ctaLabel: z.string().trim().max(40).nullable().optional(),
	ctaUrl: z.string().trim().max(500).nullable().optional(), startsAt: z.string().datetime().optional(), expiresAt: z.string().datetime().nullable().optional(),
	status: z.enum(["active", "disabled"]).optional(),
});
const toRow = (input: Partial<z.infer<typeof updateInput>>) => ({ ...(input.title !== undefined ? { title: input.title } : {}), ...(input.body !== undefined ? { body: input.body } : {}), ...(input.type !== undefined ? { type: input.type } : {}), ...(input.ctaLabel !== undefined ? { cta_label: input.ctaLabel } : {}), ...(input.ctaUrl !== undefined ? { cta_url: input.ctaUrl } : {}), ...(input.startsAt !== undefined ? { starts_at: input.startsAt } : {}), ...(input.expiresAt !== undefined ? { expires_at: input.expiresAt } : {}), ...(input.status !== undefined ? { status: input.status } : {}), updated_at: new Date().toISOString() });

export const updatesRouter = Router();
updatesRouter.get("/", async (_request, response, next) => {
	try { const now = new Date().toISOString(); const { data, error } = await getSupabaseAdmin().from("product_updates").select("*").eq("status", "active").lte("starts_at", now).or(`expires_at.is.null,expires_at.gt.${now}`).order("created_at", { ascending: false }); if (error) throw error; response.json(data ?? []); } catch (error) { next(error); }
});

export const adminUpdatesRouter = Router();
adminUpdatesRouter.get("/", async (_request, response, next) => { try { const { data, error } = await getSupabaseAdmin().from("product_updates").select("*").order("created_at", { ascending: false }); if (error) throw error; response.json(data ?? []); } catch (error) { next(error); } });
adminUpdatesRouter.post("/", async (request: AdminRequest, response, next) => { const parsed = updateInput.safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: "Invalid update details", fields: parsed.error.flatten().fieldErrors }); try { const { data, error } = await getSupabaseAdmin().from("product_updates").insert({ ...toRow(parsed.data), admin_id: request.userId }).select().single(); if (error) throw error; response.status(201).json(data); } catch (error) { next(error); } });
adminUpdatesRouter.patch("/:id", async (request: AdminRequest, response, next) => { const parsed = updateInput.partial().safeParse(request.body); if (!parsed.success || Object.keys(parsed.data).length === 0) return response.status(400).json({ error: "Invalid update details" }); try { const { data, error } = await getSupabaseAdmin().from("product_updates").update(toRow(parsed.data)).eq("id", request.params.id).select().single(); if (error) throw error; response.json(data); } catch (error) { next(error); } });
adminUpdatesRouter.delete("/:id", async (request, response, next) => { try { const { error } = await getSupabaseAdmin().from("product_updates").delete().eq("id", request.params.id); if (error) throw error; response.status(204).send(); } catch (error) { next(error); } });