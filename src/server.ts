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
  verifyTelnyxWebhook,
} from "./services/telephony/TelnyxWebhookService.js";
import { getSupabaseAdmin } from "./services/supabase.js";

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
  response.json({ ok: true, service: "handsfree-backend" }),
);
app.post("/telnyx/webhook", async (request, response) => {
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
    const event = JSON.parse(raw) as {
      data?: {
        event_type?: string;
        payload?: {
          call_control_id?: string;
          end_time?: string;
          start_time?: string;
        };
      };
    };
    const status = mapTelnyxCallStatus(event.data?.event_type ?? "");
    const providerCallId = event.data?.payload?.call_control_id;
    if (status && providerCallId) {
      const database = getSupabaseAdmin();
      await database
        .from("calls")
        .update({
          status,
          ...(status === "completed" || status === "failed"
            ? {
                ended_at:
                  event.data?.payload?.end_time ?? new Date().toISOString(),
              }
            : {}),
          ...(status === "connected"
            ? {
                started_at:
                  event.data?.payload?.start_time ?? new Date().toISOString(),
              }
            : {}),
        })
        .eq("provider_call_id", providerCallId);
    }
    response.sendStatus(204);
  } catch (error) {
    console.error(error);
    response.sendStatus(204);
  }
});
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
    console.error(error.message);
    response.status(500).json({ error: "Unexpected server error" });
  },
);
const server = createServer(app);
attachConversationRelay(server, config.GEMINI_API_KEY);
server.listen(config.PORT, () =>
  process.stdout.write(`HandsFree backend listening on ${config.PORT}\n`),
);
