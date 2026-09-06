import express from "express";
import cors from "cors";
import helmet from "helmet";
import { createServer } from "node:http";
import twilio from "twilio";
import { config } from "./config.js";
import { requireAuth } from "./middleware/auth.js";
import { requireAdmin } from "./middleware/admin.js";
import { agentsRouter } from "./routes/agents.js";
import { contactsRouter } from "./routes/contacts.js";
import { callsRouter } from "./routes/calls.js";
import { searchRouter } from "./routes/search.js";
import { tasksRouter } from "./routes/tasks.js";
import { settingsRouter } from "./routes/settings.js";
import { billingRouter } from "./routes/billing.js";
import { adminRouter } from "./routes/admin.js";
import { numbersRouter } from "./routes/numbers.js";
import { knowledgeRouter } from "./routes/knowledge.js";
import { supportRouter } from "./routes/support.js";
import { getSupabaseAdmin } from "./services/supabase.js";
import { TwilioProvider } from "./services/telephony/TwilioProvider.js";
import { attachConversationRelay, attachSpeechEngine } from "./services/telephony/ConversationRelayService.js";
import { reconcileCallMinutes } from "./services/billing/UsageService.js";
import { getEntitlement } from "./services/billing/EntitlementService.js";
import { reserveCallMinutes } from "./services/billing/UsageService.js";
import { processDueTasks } from "./services/tasks/TaskScheduler.js";

const app = express();
app.use(helmet());
app.use(cors({ origin: config.FRONTEND_ORIGIN }));
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: "1mb" }));

function streamUrl() {
  const base = config.PUBLIC_WS_URL ?? config.PUBLIC_URL?.replace(/^http/, "ws");
  if (!base) throw new Error("PUBLIC_WS_URL or PUBLIC_URL is required for media streams");
  return `${base.replace(/\/$/, "")}/api/telephony/twilio/media-stream`;
}

function twimlForStream(callId: string) {
  const response = new twilio.twiml.VoiceResponse();
  const stream = response.connect().stream({ url: streamUrl(), name: callId });
  stream.parameter({ name: "callId", value: callId });
  return response.toString();
}

function validTwilioWebhook(request: express.Request) {
  return TwilioProvider.validateWebhook(request);
}

app.get("/health", (_request, response) => response.json({
  database: config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY ? "configured" : "not configured",
  twilio: config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN ? "configured" : "not configured",
  speechEngine: config.ELEVENLABS_SPEECH_ENGINE_ID && config.ELEVENLABS_SHARED_SECRET ? "configured" : "not configured",
  gemini: config.GEMINI_API_KEY ? "configured" : "not configured",
  paypal: config.PAYPAL_CLIENT_ID && config.PAYPAL_CLIENT_SECRET ? "configured" : "not configured",
}));

app.post("/api/telephony/twilio/answer/:callId", async (request, response, next) => {
  if (!validTwilioWebhook(request)) return response.status(401).send("Invalid Twilio signature");
  try {
    const updated = await getSupabaseAdmin().from("calls").update({ status: "connected", answered_at: new Date().toISOString() }).eq("id", request.params.callId);
    if (updated.error) throw updated.error;
    response.type("text/xml").send(twimlForStream(request.params.callId));
  } catch (error) { next(error); }
});

app.post("/api/telephony/twilio/status", async (request, response, next) => {
  if (!validTwilioWebhook(request)) return response.status(401).send("Invalid Twilio signature");
  try {
    const statusMap: Record<string, string> = {
      queued: "queued", ringing: "ringing", "in-progress": "connected", completed: "completed",
      busy: "busy", failed: "failed", "no-answer": "no_answer", canceled: "cancelled",
    };
    const status = statusMap[String(request.body.CallStatus)];
    if (status) {
      const update: Record<string, unknown> = { status };
      if (["completed", "busy", "failed", "no_answer", "cancelled"].includes(status)) {
        update.ended_at = new Date().toISOString();
        if (request.body.CallDuration) update.duration_seconds = Number(request.body.CallDuration);
      }
      const updated = await getSupabaseAdmin().from("calls").update(update).eq("provider_call_id", request.body.CallSid);
      if (updated.error) throw updated.error;
      if (["completed", "busy", "failed", "no_answer", "cancelled"].includes(status)) {
        const call = await getSupabaseAdmin().from("calls").select("id,task_id").eq("provider_call_id", request.body.CallSid).maybeSingle();
        if (call.error) throw call.error;
        if (call.data) {
          await reconcileCallMinutes(call.data.id, Number(request.body.CallDuration ?? 0));
          if (call.data.task_id) {
            await getSupabaseAdmin().from("call_tasks").update({ status: status === "completed" ? "completed" : "failed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", call.data.task_id);
          }
        }
      }
    }
    response.sendStatus(204);
  } catch (error) { next(error); }
});

app.post("/api/telephony/twilio/incoming", async (request, response, next) => {
  if (!validTwilioWebhook(request)) return response.status(401).send("Invalid Twilio signature");
  try {
    const database = getSupabaseAdmin();
    const assigned = await database.from("phone_numbers").select("id,user_id,agent_id").eq("phone_number", request.body.To).eq("status", "active").maybeSingle();
    if (assigned.error) throw assigned.error;
    if (!assigned.data) return response.status(404).send("Number not assigned");
    const profile = await database.from("profiles").select("status").eq("id", assigned.data.user_id).single();
    if (profile.error) throw profile.error;
    if (profile.data.status !== "active") return response.status(403).send("Account is not active");
    let agentId = assigned.data.agent_id;
    if (!agentId) {
      const agent = await database.from("ai_agents").select("id").eq("user_id", assigned.data.user_id).eq("status", "active").order("created_at").limit(1).maybeSingle();
      if (agent.error) throw agent.error;
      agentId = agent.data?.id ?? null;
    }
    const created = await database.from("calls").insert({
      user_id: assigned.data.user_id, agent_id: agentId, phone_number_id: assigned.data.id,
      provider: "twilio", provider_call_id: request.body.CallSid, from_number: request.body.From,
      to_number: request.body.To, direction: "inbound", status: "connected", answered_at: new Date().toISOString(),
    }).select("id").single();
    if (created.error) throw created.error;
    const entitlement = await getEntitlement(assigned.data.user_id);
    const reservationMinutes = Math.max(1, Number(entitlement.plan?.plans.max_call_duration_minutes ?? 5));
    if (!(await reserveCallMinutes(assigned.data.user_id, created.data.id, reservationMinutes))) {
      await database.from("calls").update({ status: "failed", failure_reason: "INSUFFICIENT_MINUTES" }).eq("id", created.data.id);
      const rejected = new twilio.twiml.VoiceResponse();
      rejected.say("This account does not have enough calling minutes available.");
      rejected.hangup();
      return response.type("text/xml").send(rejected.toString());
    }
    response.type("text/xml").send(twimlForStream(created.data.id));
  } catch (error) { next(error); }
});

app.get("/api/me", requireAuth, (request, response) => response.json({ userId: (request as { userId?: string }).userId }));
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

app.use((error: Error, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (/column .* does not exist|schema cache|relation .* does not exist/i.test(error.message)) return response.status(503).json({ error: "The backend database migrations are not fully applied. Apply the latest Supabase migrations and retry." });
  console.error(JSON.stringify({ service: "handsfree-api", error: error.message }));
  response.status(500).json({ error: "Unexpected server error" });
});

const server = createServer(app);
attachConversationRelay(server);
void attachSpeechEngine(server).catch((error: Error) => console.error(JSON.stringify({ service: "speech-engine", status: "startup_failed", error: error.message })));
server.listen(config.PORT, () => process.stdout.write(`HandsFree backend listening on ${config.PORT}\n`));
const taskWorkerTimer = setInterval(() => {
  void processDueTasks().catch((error: Error) => console.error(JSON.stringify({ service: "task-worker", status: "failed", error: error.message })));
}, 15_000);
taskWorkerTimer.unref();
void processDueTasks().catch((error: Error) => console.error(JSON.stringify({ service: "task-worker", status: "startup_failed", error: error.message })));
