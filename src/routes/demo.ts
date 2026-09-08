import { Router } from "express";
import { z } from "zod";
import { getSupabaseAdmin } from "../services/supabase.js";

const demoInput = z.object({
  fullName: z.string().trim().min(2).max(120),
  businessName: z.string().trim().max(160).nullable().optional(),
  email: z.string().trim().email().max(200),
  phoneNumber: z.string().trim().max(40).nullable().optional(),
  businessType: z.string().trim().max(80).nullable().optional(),
  employeeCount: z.string().trim().max(40).nullable().optional(),
  agentType: z.enum(["sales", "customer_service", "booking", "receptionist", "lead_qualification", "support", "custom"]).default("custom"),
  message: z.string().trim().max(4000).nullable().optional(),
});

export const demoRouter = Router();

demoRouter.post("/requests", async (request, response, next) => {
  const parsed = demoInput.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: "Please check the required demo request fields.", fields: parsed.error.flatten().fieldErrors });
  try {
    const input = parsed.data;
    const { data, error } = await getSupabaseAdmin().from("demo_requests").insert({
      full_name: input.fullName,
      business_name: input.businessName || null,
      email: input.email,
      phone_number: input.phoneNumber || null,
      business_type: input.businessType || null,
      employee_count: input.employeeCount || null,
      agent_type: input.agentType,
      message: input.message || null,
    }).select("id,status,created_at").single();
    if (error) throw error;
    response.status(201).json(data);
  } catch (error) {
    next(error);
  }
});