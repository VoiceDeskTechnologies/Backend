import { Router } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../middleware/auth.js";
import { getSupabaseAdmin } from "../services/supabase.js";
import { calculatePaygPrice } from "../services/billing.js";
import { requireAuth } from "../middleware/auth.js";
import { getEntitlement } from "../services/billing/EntitlementService.js";
import { getOrCreateTrial } from "../services/billing/TrialService.js";
import { createPayPalOrder, capturePayPalOrder } from "../services/billing/PayPalService.js";
import { provisionNumberForUser } from "../services/telephony/TelnyxNumberService.js";

export const billingRouter = Router();
billingRouter.get("/plans", async (_request, response, next) => { try { const { data, error } = await getSupabaseAdmin().from("plans").select("*").eq("active", true).order("monthly_price"); if (error) throw error; response.json(data); } catch (error) { next(error); } });
billingRouter.get("/payg", async (_request, response, next) => { try { const { data, error } = await getSupabaseAdmin().from("payg_packages").select("*").eq("active", true).order("minutes"); if (error) throw error; response.json(data); } catch (error) { next(error); } });
billingRouter.post("/payg/calculate", async (request, response, next) => { const parsed = z.object({ minutes: z.coerce.number().int() }).safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: "Minutes must be a whole number" }); try { response.json(await calculatePaygPrice(parsed.data.minutes)); } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : "Unable to calculate price" }); } });
billingRouter.get("/usage", requireAuth, async (request: AuthenticatedRequest, response, next) => { try { const database = getSupabaseAdmin(); const [entitlement, calls] = await Promise.all([getEntitlement(request.userId!), database.from("calls").select("id,direction,duration_seconds,status").eq("user_id", request.userId)]); if (calls.error) throw calls.error; response.json({ ...entitlement, calls: calls.data ?? [] }); } catch (error) { next(error); } });
billingRouter.get("/trial", requireAuth, async (request: AuthenticatedRequest, response, next) => { try { response.json(await getOrCreateTrial(request.userId!)); } catch (error) { next(error); } });
billingRouter.get("/billing", requireAuth, async (request: AuthenticatedRequest, response, next) => { try { const database = getSupabaseAdmin(); const [period, purchases] = await Promise.all([database.from("plan_periods").select("*,plans(name,monthly_price,minutes)").eq("user_id", request.userId).order("period_end", { ascending: false }).limit(1).maybeSingle(), database.from("payg_purchases").select("*,payg_packages(product_id)").eq("user_id", request.userId).order("created_at", { ascending: false })]); if (period.error || purchases.error) throw period.error ?? purchases.error; response.json({ period: period.data, purchases: purchases.data ?? [] }); } catch (error) { next(error); } });
billingRouter.get("/recommendation", async (request, response, next) => { const minutes = Math.max(0, Number(request.query.minutes ?? 0)); try { const { data, error } = await getSupabaseAdmin().from("plans").select("id,name,monthly_price,minutes").eq("active", true).order("minutes"); if (error) throw error; const plan = (data ?? []).find((candidate) => candidate.minutes >= minutes) ?? data?.at(-1); response.json({ recommendedPlan: plan, additionalMinutes: Math.max(0, minutes - (plan?.minutes ?? 0)) }); } catch (error) { next(error); } });

billingRouter.post("/billing/paypal/orders", requireAuth, async (request: AuthenticatedRequest, response, next) => {
	const parsed = z.object({ planId: z.string().uuid(), areaCode: z.string().regex(/^\d{3}$/).optional() }).safeParse(request.body);
	if (!parsed.success) return response.status(400).json({ error: "A valid plan is required" });
	try {
		const database = getSupabaseAdmin();
		const { data: plan, error: planError } = await database.from("plans").select("id,name,monthly_price,currency,phone_numbers,area_code_selection").eq("id", parsed.data.planId).eq("active", true).single();
		if (planError) throw planError;
		if (!plan || Number(plan.monthly_price) <= 0) return response.status(400).json({ error: "That plan is not available for purchase" });
		if (parsed.data.areaCode && !plan.area_code_selection) return response.status(400).json({ error: "That plan does not support area-code selection" });
		const paypal = await createPayPalOrder(Number(plan.monthly_price), plan.currency ?? "USD", request.userId!, plan.id);
		if (!paypal.id) throw new Error("PayPal did not return an order ID");
		const { data: payment, error } = await database.from("payments").insert({
			user_id: request.userId,
			paypal_order_id: paypal.id,
			product_type: "plan",
			product_id: plan.id,
			amount: plan.monthly_price,
			currency: plan.currency ?? "USD",
			status: "pending",
			verification_status: "unverified",
			metadata: { areaCode: parsed.data.areaCode ?? null },
		}).select().single();
		if (error) throw error;
		response.status(201).json({ orderId: paypal.id, paymentId: payment.id, plan, approvalUrl: paypal.links?.find((link) => link.rel === "approve")?.href ?? null });
	} catch (error) {
		next(error);
	}
});

billingRouter.post("/billing/paypal/orders/:orderId/capture", requireAuth, async (request: AuthenticatedRequest, response, next) => {
	try {
		const database = getSupabaseAdmin();
		const { data: payment, error: paymentError } = await database.from("payments").select("*").eq("paypal_order_id", request.params.orderId).eq("user_id", request.userId).maybeSingle();
		if (paymentError) throw paymentError;
		if (!payment) return response.status(404).json({ error: "Payment not found" });
		if (payment.status === "successful") return response.json({ payment, numberStatus: "active" });
		const { data: plan, error: planError } = await database.from("plans").select("*").eq("id", payment.product_id).single();
		if (planError) throw planError;
		const paypal = await capturePayPalOrder(String(request.params.orderId));
		const purchase = paypal.purchase_units?.[0];
		const capture = purchase?.payments?.captures?.[0];
		const expectedAmount = Number(payment.amount).toFixed(2);
		if (paypal.status !== "COMPLETED" || capture?.status !== "COMPLETED" || purchase?.amount?.value !== expectedAmount || purchase.amount.currency_code !== payment.currency)
			return response.status(402).json({ error: "PayPal payment could not be verified" });
		const now = new Date();
		const periodEnd = new Date(now.getTime() + 30 * 86400000);
		const { data: currentPeriod, error: periodError } = await database.from("plan_periods").select("id").eq("user_id", request.userId).eq("status", "active").maybeSingle();
		if (periodError) throw periodError;
		const period = currentPeriod
			? await database.from("plan_periods").update({ plan_id: payment.product_id, period_start: now.toISOString(), period_end: periodEnd.toISOString(), included_minutes: plan.minutes, used_minutes: 0, updated_at: now.toISOString() }).eq("id", currentPeriod.id)
			: await database.from("plan_periods").insert({ user_id: request.userId, plan_id: payment.product_id, period_start: now.toISOString(), period_end: periodEnd.toISOString(), included_minutes: plan.minutes, status: "active" });
		if (period.error) throw period.error;
		const balance = await database.from("usage_balances").upsert({ user_id: request.userId, monthly_remaining: plan.minutes, updated_at: now.toISOString() }, { onConflict: "user_id" });
		if (balance.error) throw balance.error;
		const { data: updatedPayment, error: updateError } = await database.from("payments").update({ status: "successful", verification_status: "verified", paypal_capture_id: capture.id ?? null, metadata: { ...(payment.metadata ?? {}), paypalStatus: paypal.status }, }).eq("id", payment.id).select().single();
		if (updateError) throw updateError;
		let numberStatus = "active";
		let number = null;
		try {
			const provisioned = await provisionNumberForUser(request.userId!, { paymentId: payment.id, areaCode: payment.metadata?.areaCode, idempotencyKey: `payment:${payment.id}` });
			number = provisioned.number;
			numberStatus = provisioned.status;
		} catch (provisioningError) {
			numberStatus = "failed";
			console.error(JSON.stringify({ event: "number_provisioning_failed_after_payment", userId: request.userId, paymentId: payment.id, errorCode: provisioningError instanceof Error ? provisioningError.name : "UNKNOWN_ERROR" }));
		}
		response.json({ payment: updatedPayment, plan, number, numberStatus });
	} catch (error) {
		next(error);
	}
});