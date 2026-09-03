import { Router } from "express";
import { z } from "zod";
import type { AdminRequest } from "../middleware/admin.js";
import { getSupabaseAdmin } from "../services/supabase.js";
import { config } from "../config.js";
import { claimConfiguredNumberForUser, ensureNumberForUser, getNumber, listOwnedNumbers } from "../services/telephony/TelnyxNumberService.js";

export const adminRouter = Router();
adminRouter.get("/telephony/config", (_request, response) =>
  response.json({
    provider: "telnyx",
    configured: {
      apiKey: Boolean(config.TELNYX_API_KEY),
      connectionId: Boolean(config.TELNYX_CONNECTION_ID),
      phoneNumber: Boolean(config.TELNYX_PHONE_NUMBER),
      publicKey: Boolean(config.TELNYX_PUBLIC_KEY),
      publicUrl: Boolean(config.PUBLIC_URL),
    },
  }),
);

adminRouter.get("/phone-numbers", async (_request, response, next) => {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("phone_numbers")
      .select("*, profiles(display_name)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    response.json(data ?? []);
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/phone-numbers/inventory", async (_request, response, next) => {
  try {
    response.json(await listOwnedNumbers());
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/phone-numbers/claim-configured", async (request: AdminRequest, response, next) => {
  const parsed = z.object({ userId: z.string().uuid() }).safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: "A target user is required" });
  try {
    const claimed = await claimConfiguredNumberForUser(parsed.data.userId);
    if (claimed.created)
      await audit(request, "configured_phone_number_claimed", "user", parsed.data.userId, { phone_number_id: claimed.number?.id });
    response.status(claimed.created ? 201 : 200).json(claimed);
  } catch (error) {
    next(error);
  }
});

adminRouter.post("/phone-numbers/import", async (request: AdminRequest, response, next) => {
  const parsed = z.object({ telnyxPhoneNumberId: z.string().trim().min(1), userId: z.string().uuid() }).safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ error: "Telnyx number ID and target user are required" });
  try {
    const number = await getNumber(parsed.data.telnyxPhoneNumberId);
    if (!number.id || !number.phone_number) return response.status(404).json({ error: "Telnyx number not found" });
    if (number.connection_id && number.connection_id !== config.TELNYX_CONNECTION_ID)
      return response.status(400).json({ error: "That number is not attached to the configured Telnyx connection" });
    const database = getSupabaseAdmin();
    const existing = await database.from("phone_numbers").select("id").eq("telnyx_phone_number_id", number.id).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data) return response.status(409).json({ error: "That Telnyx number is already imported" });
    const { data, error } = await database.from("phone_numbers").insert({
      user_id: parsed.data.userId,
      phone_number: number.phone_number,
      provider: "telnyx",
      provider_number_id: number.id,
      telnyx_phone_number_id: number.id,
      connection_id: number.connection_id ?? config.TELNYX_CONNECTION_ID,
      country: number.country_code ?? config.TELNYX_DEFAULT_COUNTRY,
      country_code: number.country_code ?? config.TELNYX_DEFAULT_COUNTRY,
      area_code: number.phone_number.match(/^\+1(\d{3})/)?.[1] ?? null,
      status: "active",
      provisioning_status: "active",
      is_default: false,
      assigned_at: new Date().toISOString(),
      capabilities: number.features ?? { voice: true },
    }).select().single();
    if (error) {
      if (error.code === "23505") return response.status(409).json({ error: "That Telnyx number is already imported" });
      throw error;
    }
    await audit(request, "phone_number_imported", "phone_number", data.id, { telnyx_number_id: number.id, user_id: parsed.data.userId });
    response.status(201).json(data);
  } catch (error) {
    next(error);
  }
});

async function audit(
  request: AdminRequest,
  action: string,
  resource: string,
  resourceId: string | string[] | undefined,
  metadata: Record<string, unknown> = {},
) {
  if (!request.userId) return;
  await getSupabaseAdmin()
    .from("audit_logs")
    .insert({
      admin_id: request.userId,
      action,
      resource,
      resource_id: resourceId ? String(resourceId) : null,
      ip_address: request.ip,
      user_agent: request.get("user-agent"),
      metadata,
    });
}

function requireSuperAdmin(
  request: AdminRequest,
  response: Parameters<Parameters<typeof adminRouter.patch>[1]>[1],
) {
  if (request.adminRole !== "super_administrator") {
    response.status(403).json({ error: "Super administrator access required" });
    return false;
  }
  return true;
}

adminRouter.get("/dashboard", async (_request, response, next) => {
  try {
    const database = getSupabaseAdmin();
    const [users, calls, minutes, numbers, agents, support] = await Promise.all(
      [
        database.from("profiles").select("id", { count: "exact", head: true }),
        database.from("calls").select("id", { count: "exact", head: true }),
        database
          .from("usage_ledger")
          .select("amount,created_at")
          .eq("unit", "minutes"),
        database
          .from("phone_numbers")
          .select("id", { count: "exact", head: true })
          .eq("status", "active"),
        database
          .from("ai_agents")
          .select("id", { count: "exact", head: true })
          .eq("status", "active"),
        database
          .from("support_tickets")
          .select("id", { count: "exact", head: true })
          .in("status", ["open", "in_progress", "waiting"]),
      ],
    );
    const failure = [users, calls, minutes, numbers, agents, support].find(
      (result) => result.error,
    )?.error;
    if (failure) throw failure;
    const aiMinutes = (minutes.data ?? []).reduce(
      (total, row) => total + Number(row.amount),
      0,
    );
    const now = Date.now();
    const usageSeries = Array.from({ length: 8 }, (_, index) => {
      const start = now - (7 - index) * 7 * 86400000;
      const end = start + 7 * 86400000;
      return (minutes.data ?? [])
        .filter((row) => {
          const timestamp = new Date(row.created_at).getTime();
          return timestamp >= start && timestamp < end;
        })
        .reduce((total, row) => total + Number(row.amount), 0);
    });
    response.json({
      kpis: {
        users: users.count ?? 0,
        calls: calls.count ?? 0,
        aiMinutes,
        activeNumbers: numbers.count ?? 0,
        activeAgents: agents.count ?? 0,
        openTickets: support.count ?? 0,
      },
      usageSeries,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/users", async (request, response, next) => {
  try {
    const page = Math.max(1, Number(request.query.page ?? 1));
    const pageSize = Math.min(
      100,
      Math.max(1, Number(request.query.pageSize ?? 25)),
    );
    const search = String(request.query.search ?? "").trim();
    let query = getSupabaseAdmin()
      .from("profiles")
      .select("id,display_name,status,created_at,updated_at", {
        count: "exact",
      })
      .order("created_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (search)
      query = query.or(`display_name.ilike.%${search}%,id.eq.${search}`);
    const { data, count, error } = await query;
    if (error) throw error;
    response.json({ data: data ?? [], page, pageSize, total: count ?? 0 });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/users/:id", async (request, response, next) => {
  try {
    const database = getSupabaseAdmin();
    const [profile, period, balance, calls, agents, numbers, admin] =
      await Promise.all([
        database
          .from("profiles")
          .select("*")
          .eq("id", request.params.id)
          .maybeSingle(),
        database
          .from("plan_periods")
          .select("*,plans(*)")
          .eq("user_id", request.params.id)
          .order("period_end", { ascending: false })
          .limit(1)
          .maybeSingle(),
        database
          .from("usage_balances")
          .select("*")
          .eq("user_id", request.params.id)
          .maybeSingle(),
        database
          .from("calls")
          .select("id,status,duration_seconds,created_at", { count: "exact" })
          .eq("user_id", request.params.id),
        database
          .from("ai_agents")
          .select("id", { count: "exact", head: true })
          .eq("user_id", request.params.id),
        database
          .from("phone_numbers")
          .select("id", { count: "exact", head: true })
          .eq("user_id", request.params.id),
        database
          .from("admin_users")
          .select("role,active")
          .eq("user_id", request.params.id)
          .maybeSingle(),
      ]);
    const failure = [
      profile,
      period,
      balance,
      calls,
      agents,
      numbers,
      admin,
    ].find((result) => result.error)?.error;
    if (failure) throw failure;
    if (!profile.data)
      return response.status(404).json({ error: "User not found" });
    const durations = (calls.data ?? []).map((call) =>
      Number(call.duration_seconds ?? 0),
    );
    response.json({
      profile: profile.data,
      plan: period.data,
      balance: balance.data,
      calls: {
        total: calls.count ?? 0,
        completed: (calls.data ?? []).filter(
          (call) => call.status === "completed",
        ).length,
        failed: (calls.data ?? []).filter((call) => call.status === "failed")
          .length,
        averageDurationSeconds: durations.length
          ? Math.round(
              durations.reduce((sum, value) => sum + value, 0) /
                durations.length,
            )
          : 0,
      },
      agents: agents.count ?? 0,
      numbers: numbers.count ?? 0,
      admin: admin.data,
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/plans", async (_request, response, next) => {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("plans")
      .select("id,name,monthly_price,minutes,active")
      .order("monthly_price");
    if (error) throw error;
    response.json(data ?? []);
  } catch (error) {
    next(error);
  }
});

adminRouter.get(
  "/support/unread-count",
  async (request: AdminRequest, response, next) => {
    try {
      const database = getSupabaseAdmin();
      const { data: tickets, error: ticketError } = await database
        .from("support_tickets")
        .select("id")
        .in("status", ["open", "in_progress", "waiting"]);
      if (ticketError) throw ticketError;
      const ticketIds = (tickets ?? []).map((ticket) => ticket.id);
      if (!ticketIds.length) return response.json({ count: 0, badge: null });
      const [
        { data: messages, error: messageError },
        { data: reads, error: readError },
      ] = await Promise.all([
        database
          .from("support_messages")
          .select("ticket_id,created_at,author_type")
          .in("ticket_id", ticketIds)
          .order("created_at", { ascending: false }),
        database
          .from("support_ticket_reads")
          .select("ticket_id,read_at")
          .eq("admin_user_id", request.userId),
      ]);
      if (messageError || readError) throw messageError ?? readError;
      const readByTicket = new Map(
        (reads ?? []).map((read) => [read.ticket_id, read.read_at]),
      );
      const latest = new Map<
        string,
        { created_at: string; author_type: string }
      >();
      for (const message of messages ?? [])
        if (!latest.has(message.ticket_id))
          latest.set(message.ticket_id, message);
      const count = [...latest].filter(
        ([ticketId, message]) =>
          message.author_type === "customer" &&
          (!readByTicket.has(ticketId) ||
            readByTicket.get(ticketId)! < message.created_at),
      ).length;
      response.json({
        count,
        badge: count === 0 ? null : count > 20 ? "20+" : String(count),
      });
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.get("/support/tickets", async (request, response, next) => {
  try {
    const page = Math.max(1, Number(request.query.page ?? 1));
    const pageSize = Math.min(
      100,
      Math.max(1, Number(request.query.pageSize ?? 25)),
    );
    const status = String(request.query.status ?? "");
    let query = getSupabaseAdmin()
      .from("support_tickets")
      .select(
        "id,ticket_number,user_id,subject,status,priority,assigned_admin_id,last_message_at,created_at,updated_at",
        { count: "exact" },
      )
      .order("updated_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (
      ["open", "in_progress", "waiting", "resolved", "closed"].includes(status)
    )
      query = query.eq("status", status);
    const { data, count, error } = await query;
    if (error) throw error;
    response.json({ data: data ?? [], page, pageSize, total: count ?? 0 });
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/support/tickets/:id", async (request, response, next) => {
  try {
    const database = getSupabaseAdmin();
    const [ticket, messages, events] = await Promise.all([
      database
        .from("support_tickets")
        .select(
          "*,profiles:user_id(id,display_name),assigned:assigned_admin_id(id,display_name)",
        )
        .eq("id", request.params.id)
        .maybeSingle(),
      database
        .from("support_messages")
        .select("*,profiles:author_id(id,display_name)")
        .eq("ticket_id", request.params.id)
        .order("created_at"),
      database
        .from("support_ticket_events")
        .select("*")
        .eq("ticket_id", request.params.id)
        .order("created_at", { ascending: false }),
    ]);
    if (ticket.error || messages.error || events.error)
      throw ticket.error ?? messages.error ?? events.error;
    if (!ticket.data)
      return response.status(404).json({ error: "Support ticket not found" });
    response.json({
      ticket: ticket.data,
      messages: messages.data ?? [],
      events: events.data ?? [],
    });
  } catch (error) {
    next(error);
  }
});

adminRouter.post(
  "/support/tickets/:id/read",
  async (request: AdminRequest, response, next) => {
    try {
      const database = getSupabaseAdmin();
      const { data: latest } = await database
        .from("support_messages")
        .select("id")
        .eq("ticket_id", request.params.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { error } = await database
        .from("support_ticket_reads")
        .upsert(
          {
            ticket_id: request.params.id,
            admin_user_id: request.userId,
            read_at: new Date().toISOString(),
            last_read_message_id: latest?.id,
          },
          { onConflict: "ticket_id,admin_user_id" },
        );
      if (error) throw error;
      await database
        .from("support_ticket_events")
        .insert({
          ticket_id: request.params.id,
          event_type: "ticket_read",
          actor_id: request.userId,
        });
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  },
);

for (const field of ["status", "priority"] as const) {
  adminRouter.patch(
    `/support/tickets/:id/${field}`,
    async (request: AdminRequest, response, next) => {
      const values =
        field === "status"
          ? ["open", "in_progress", "waiting", "resolved", "closed"]
          : ["low", "normal", "high", "urgent"];
      const parsed = z
        .object({ value: z.enum(values as [string, ...string[]]) })
        .safeParse(request.body);
      if (!parsed.success)
        return response.status(400).json({ error: `Invalid ticket ${field}` });
      try {
        const database = getSupabaseAdmin();
        const { data, error } = await database
          .from("support_tickets")
          .update({
            [field]: parsed.data.value,
            updated_at: new Date().toISOString(),
          })
          .eq("id", request.params.id)
          .select()
          .single();
        if (error) throw error;
        await database
          .from("support_ticket_events")
          .insert({
            ticket_id: request.params.id,
            event_type: `${field}_changed`,
            actor_id: request.userId,
            metadata: { value: parsed.data.value },
          });
        await audit(
          request,
          `support_${field}_changed`,
          "support_ticket",
          request.params.id,
          { value: parsed.data.value },
        );
        response.json(data);
      } catch (error) {
        next(error);
      }
    },
  );
}

adminRouter.patch(
  "/support/tickets/:id/assignment",
  async (request: AdminRequest, response, next) => {
    const parsed = z
      .object({ adminId: z.string().uuid().nullable() })
      .safeParse(request.body);
    if (!parsed.success)
      return response
        .status(400)
        .json({ error: "Invalid administrator assignment" });
    try {
      const database = getSupabaseAdmin();
      const { data, error } = await database
        .from("support_tickets")
        .update({
          assigned_admin_id: parsed.data.adminId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", request.params.id)
        .select()
        .single();
      if (error) throw error;
      await database
        .from("support_ticket_events")
        .insert({
          ticket_id: request.params.id,
          event_type: "admin_assigned",
          actor_id: request.userId,
          metadata: { admin_id: parsed.data.adminId },
        });
      await audit(
        request,
        "support_ticket_assigned",
        "support_ticket",
        request.params.id,
        { admin_id: parsed.data.adminId },
      );
      response.json(data);
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.post(
  "/support/tickets/:id/note",
  async (request: AdminRequest, response, next) => {
    const parsed = z
      .object({ body: z.string().trim().min(1).max(10000) })
      .safeParse(request.body);
    if (!parsed.success)
      return response.status(400).json({ error: "Note cannot be empty" });
    try {
      const database = getSupabaseAdmin();
      const { data, error } = await database
        .from("support_messages")
        .insert({
          ticket_id: request.params.id,
          author_id: request.userId,
          author_type: "admin",
          body: parsed.data.body,
          internal: true,
        })
        .select()
        .single();
      if (error) throw error;
      await database
        .from("support_ticket_events")
        .insert({
          ticket_id: request.params.id,
          event_type: "internal_note_added",
          actor_id: request.userId,
        });
      await audit(
        request,
        "support_internal_note_added",
        "support_ticket",
        request.params.id,
      );
      response.status(201).json(data);
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.patch(
  "/users/:id/plan",
  async (request: AdminRequest, response, next) => {
    const parsed = z
      .object({
        planId: z.string().uuid(),
        reason: z.string().trim().min(1).max(500),
      })
      .safeParse(request.body);
    if (!parsed.success)
      return response
        .status(400)
        .json({ error: "Plan and reason are required" });
    try {
      const database = getSupabaseAdmin();
      const [
        { data: plan, error: planError },
        { data: period, error: periodError },
      ] = await Promise.all([
        database
          .from("plans")
          .select("id,name,minutes")
          .eq("id", parsed.data.planId)
          .single(),
        database
          .from("plan_periods")
          .select("id,plan_id,plans(name)")
          .eq("user_id", request.params.id)
          .eq("status", "active")
          .maybeSingle(),
      ]);
      if (planError || periodError) throw planError ?? periodError;
      if (!plan) return response.status(404).json({ error: "Plan not found" });
      const now = new Date();
      const { error } = period
        ? await database
            .from("plan_periods")
            .update({
              plan_id: plan.id,
              included_minutes: plan.minutes,
              updated_at: now.toISOString(),
            })
            .eq("id", period.id)
        : await database
            .from("plan_periods")
            .insert({
              user_id: request.params.id,
              plan_id: plan.id,
              period_start: now.toISOString(),
              period_end: new Date(now.getTime() + 30 * 86400000).toISOString(),
              included_minutes: plan.minutes,
              status: "active",
            });
      if (error) throw error;
      const { error: balanceError } = await database
        .from("usage_balances")
        .upsert(
          {
            user_id: request.params.id,
            monthly_remaining: plan.minutes,
            updated_at: now.toISOString(),
          },
          { onConflict: "user_id" },
        );
      if (balanceError) throw balanceError;
      const provisioned = await ensureNumberForUser(String(request.params.id));
      await audit(request, "user_plan_changed", "user", request.params.id, {
        old_plan: period?.plans ?? null,
        new_plan: plan.name,
        reason: parsed.data.reason,
      });
      if (provisioned.created)
        await audit(
          request,
          "phone_number_provisioned",
          "user",
          request.params.id,
          { provider: "telnyx", phone_number_id: provisioned.number.id },
        );
      response.json({
        ok: true,
        plan,
        number: provisioned.number,
        numberCreated: provisioned.created,
      });
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.post(
  "/users/:id/credits",
  async (request: AdminRequest, response, next) => {
    const parsed = z
      .object({
        amount: z.number().positive().max(100000),
        unit: z.string().default("minutes"),
        type: z.enum([
          "promotional",
          "giveaway",
          "compensation",
          "referral",
          "manual_adjustment",
          "correction",
        ]),
        reason: z.string().trim().min(1).max(500),
        expiresAt: z.string().datetime().nullable().optional(),
      })
      .safeParse(request.body);
    if (!parsed.success || !request.userId)
      return response
        .status(400)
        .json({ error: "Valid credit details are required" });
    try {
      const database = getSupabaseAdmin();
      const { data, error } = await database
        .from("admin_credit_adjustments")
        .insert({
          user_id: request.params.id,
          admin_id: request.userId,
          amount: parsed.data.amount,
          unit: parsed.data.unit,
          type: parsed.data.type,
          reason: parsed.data.reason,
          expires_at: parsed.data.expiresAt ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      const { error: balanceError } = await database.rpc(
        "add_admin_credit_balance",
        {
          target_user_id: request.params.id,
          credit_amount: parsed.data.amount,
        },
      );
      if (balanceError) throw balanceError;
      await audit(request, "credits_granted", "user", request.params.id, {
        amount: parsed.data.amount,
        unit: parsed.data.unit,
        type: parsed.data.type,
      });
      response.status(201).json(data);
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.patch(
  "/users/:id/status",
  async (request: AdminRequest, response, next) => {
    const parsed = z
      .object({
        status: z.enum(["active", "suspended", "deleted"]),
        reason: z.string().trim().min(1).max(500),
      })
      .safeParse(request.body);
    if (!parsed.success)
      return response
        .status(400)
        .json({ error: "Status and reason are required" });
    try {
      const { data, error } = await getSupabaseAdmin()
        .from("profiles")
        .update({
          status: parsed.data.status,
          updated_at: new Date().toISOString(),
        })
        .eq("id", request.params.id)
        .select()
        .single();
      if (error) throw error;
      await audit(
        request,
        `user_${parsed.data.status}`,
        "user",
        request.params.id,
        { reason: parsed.data.reason },
      );
      response.json(data);
    } catch (error) {
      next(error);
    }
  },
);

adminRouter.patch(
  "/users/:id/admin-role",
  async (request: AdminRequest, response, next) => {
    if (!requireSuperAdmin(request, response)) return;
    const parsed = z
      .object({
        role: z.enum([
          "super_administrator",
          "administrator",
          "support_administrator",
          "analytics_administrator",
        ]),
        active: z.boolean(),
        reason: z.string().trim().min(1).max(500),
      })
      .safeParse(request.body);
    if (!parsed.success)
      return response
        .status(400)
        .json({ error: "Role, active state, and reason are required" });
    try {
      const database = getSupabaseAdmin();
      const { data, error } = await database
        .from("admin_users")
        .upsert({
          user_id: request.params.id,
          role: parsed.data.role,
          active: parsed.data.active,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (error) throw error;
      await audit(
        request,
        parsed.data.active ? "admin_granted" : "admin_removed",
        "user",
        request.params.id,
        { role: parsed.data.role, reason: parsed.data.reason },
      );
      response.json(data);
    } catch (error) {
      next(error);
    }
  },
);
