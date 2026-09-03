import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config.js";
import { requireAuth } from "./middleware/auth.js";
import { agentsRouter } from "./routes/agents.js";
import { contactsRouter } from "./routes/contacts.js";
import { callsRouter } from "./routes/calls.js";
import { searchRouter } from "./routes/search.js";
import { tasksRouter } from "./routes/tasks.js";
import { settingsRouter } from "./routes/settings.js";
import { billingRouter } from "./routes/billing.js";
import { createServer } from "node:http";
import { attachConversationRelay } from "./services/telephony/ConversationRelayService.js";
import { adminRouter } from "./routes/admin.js";
import { requireAdmin } from "./middleware/admin.js";
import { numbersRouter } from "./routes/numbers.js";
import { knowledgeRouter } from "./routes/knowledge.js";
import { supportRouter } from "./routes/support.js";
import {
  mapTelnyxCallStatus,
  type TelnyxCallEvent,
  verifyTelnyxWebhook,
} from "./services/telephony/TelnyxWebhookService.js";
import { getSupabaseAdmin } from "./services/supabase.js";
import { TelnyxTelephonyService } from "./services/telephony/TelephonyService.js";

const app = express();
app.use(helmet());
app.use(cors({ origin: config.FRONTEND_ORIGIN }));
app.use(
  express.json({
    limit: "1mb",
    verify: (request, _response, buffer) => {
      (request as express.Request & { rawBody?: string }).rawBody =
        buffer.toString("utf8");
    },
  }),
);
app.get("/health", (_request, response) =>
  response.json({ status: "ok", service: "handsfree-api" }),
);
async function handleTelnyxWebhook(
  request: express.Request,
  response: express.Response,
) {
  const raw =
    (request as express.Request & { rawBody?: string }).rawBody ??
    JSON.stringify(request.body);
  const valid = verifyTelnyxWebhook(
    raw,
    request.header("telnyx-signature-ed25519"),
    request.header("telnyx-timestamp"),
  );
  if (!valid)
    return response.status(401).json({ error: "Invalid Telnyx signature" });
  try {
    const event = JSON.parse(raw) as TelnyxCallEvent;
    const eventId = event.data?.id;
    const eventType = event.data?.event_type;
    const payload = event.data?.payload;
    const providerCallId = payload?.call_control_id;
    if (!eventId || !eventType || !payload)
      return response.status(400).json({ error: "Malformed Telnyx event" });
    const database = getSupabaseAdmin();
    const recorded = await database
      .from("call_provider_events")
      .insert({
        provider_event_id: eventId,
        provider_call_id: providerCallId ?? null,
        event_type: eventType,
        payload: event,
      });
    if (recorded.error) {
      if (recorded.error.code === "23505") return response.sendStatus(204);
      throw recorded.error;
    }
    if (
      eventType === "call.initiated" &&
      payload.direction === "incoming" &&
      providerCallId &&
      payload.to
    ) {
      const assigned = await database
        .from("phone_numbers")
        .select("id,user_id,agent_id")
        .eq("phone_number", payload.to)
        .eq("status", "active")
        .maybeSingle();
      if (assigned.error) throw assigned.error;
      if (assigned.data) {
        const existing = await database
          .from("calls")
          .select("id")
          .eq("provider_call_id", providerCallId)
          .maybeSingle();
        if (existing.error) throw existing.error;
        if (!existing.data) {
          const created = await database
            .from("calls")
            .insert({
              user_id: assigned.data.user_id,
              agent_id: assigned.data.agent_id,
              phone_number_id: assigned.data.id,
              provider: "telnyx",
              provider_call_id: providerCallId,
              from_number: payload.from ?? null,
              to_number: payload.to,
              direction: "inbound",
              status: "queued",
              created_at: payload.start_time ?? new Date().toISOString(),
            })
            .select("id")
            .single();
          if (created.error && created.error.code !== "23505")
            throw created.error;
        }
        void new TelnyxTelephonyService()
          .answerCall(providerCallId)
          .then(() =>
            new TelnyxTelephonyService().speak(
              providerCallId,
              "Welcome to HandsFree. Your connection is working.",
            ),
          )
          .catch((error: Error) =>
            console.error(
              `Telnyx inbound call command failed: ${error.message}`,
            ),
          );
      }
    }
    if (providerCallId) {
      const status =
        eventType === "call.hangup" &&
        payload.hangup_cause?.toLowerCase().includes("cancel")
          ? "cancelled"
          : mapTelnyxCallStatus(eventType);
      if (status) {
        const endedAt = payload.end_time ?? new Date().toISOString();
        const update = {
          status,
          ...(status === "connected"
            ? {
                started_at: payload.start_time ?? new Date().toISOString(),
                answered_at: payload.answered_at ?? new Date().toISOString(),
              }
            : {}),
          ...(status === "completed" ||
          status === "cancelled" ||
          status === "failed"
            ? {
                ended_at: endedAt,
                failure_reason:
                  status === "failed"
                    ? (payload.failure_reason ?? payload.hangup_cause ?? null)
                    : null,
                ...(payload.start_time && payload.end_time
                  ? {
                      duration_seconds: Math.max(
                        0,
                        Math.round(
                          (new Date(payload.end_time).getTime() -
                            new Date(payload.start_time).getTime()) /
                            1000,
                        ),
                      ),
                    }
                  : {}),
              }
            : {}),
        };
        const updated = await database
          .from("calls")
          .update(update)
          .eq("provider_call_id", providerCallId);
        if (updated.error) throw updated.error;
      }
    }
    response.sendStatus(204);
  } catch (error) {
    console.error(
      `Telnyx webhook processing failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    response.status(500).json({ error: "Webhook processing failed" });
  }
}
app.post("/api/webhooks/telnyx", handleTelnyxWebhook);
app.post("/telnyx/webhook", handleTelnyxWebhook);
app.get("/api/me", requireAuth, (request, response) =>
  response.json({ userId: (request as { userId?: string }).userId }),
);
app.use("/api/agents", requireAuth, agentsRouter);
app.use("/api/contacts", requireAuth, contactsRouter);
app.use("/api/calls", requireAuth, callsRouter);
app.use("/api/search", requireAuth, searchRouter);
app.use("/api/tasks", requireAuth, tasksRouter);
app.use("/api/settings", requireAuth, settingsRouter);
app.use("/api/numbers", requireAuth, numbersRouter);
app.use("/api/knowledge", requireAuth, knowledgeRouter);
app.use("/api/support", requireAuth, supportRouter);
app.use("/api/admin", requireAuth, requireAdmin, adminRouter);
app.use("/api", billingRouter);
app.use("/api", requireAuth, (_request, response) =>
  response.status(501).json({ error: "This API capability is not configured" }),
);
app.use(
  (
    error: Error,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    if (error instanceof SyntaxError && "body" in error)
      return response.status(400).json({ error: "Malformed JSON payload" });
    console.error(error.message);
    if (/column .* does not exist|schema cache|relation .* does not exist/i.test(error.message))
      return response.status(503).json({ error: "The backend database migrations are not fully applied. Apply the latest Supabase migrations and retry." });
    response.status(500).json({ error: "Unexpected server error" });
  },
);
const server = createServer(app);
attachConversationRelay(server, config.GEMINI_API_KEY);
server.listen(config.PORT, () =>
  process.stdout.write(`HandsFree backend listening on ${config.PORT}\n`),
);
