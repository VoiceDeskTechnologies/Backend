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

const app = express();
app.use(helmet());
app.use(cors({ origin: config.FRONTEND_ORIGIN }));
app.use(express.json({ limit: "1mb" }));
app.get("/health", (_request, response) => response.json({ ok: true, service: "handsfree-backend" }));
app.post("/twiml", (_request, response) => {
  if (!config.PUBLIC_URL) return response.status(503).type("text/plain").send("Telephony webhook is not configured");
  const websocketUrl = config.PUBLIC_URL.replace(/^http/, "ws") + "/ws";
  response.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?><Response><Connect><ConversationRelay url="${websocketUrl}" welcomeGreeting="Hi, I'm an AI assistant calling on behalf of HandsFree. How can I help?" ttsProvider="Google" /></Connect></Response>`);
});
app.post("/twiml/status", (request, response) => {
  process.stdout.write(`Twilio call ${String(request.body.CallSid ?? "unknown")} status: ${String(request.body.CallStatus ?? "unknown")}\n`);
  response.sendStatus(204);
});
app.get("/api/me", requireAuth, (request, response) => response.json({ userId: (request as { userId?: string }).userId }));
app.use("/api/agents", requireAuth, agentsRouter);
app.use("/api/contacts", requireAuth, contactsRouter);
app.use("/api/calls", requireAuth, callsRouter);
app.use("/api/search", requireAuth, searchRouter);
app.use("/api/tasks", requireAuth, tasksRouter);
app.use("/api/settings", requireAuth, settingsRouter);
app.use("/api/admin", requireAuth, requireAdmin, adminRouter);
app.use("/api", billingRouter);
app.use("/api", requireAuth, (_request, response) => response.status(501).json({ error: "This API capability is not configured" }));
app.use((error: Error, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error(error.message);
  response.status(500).json({ error: "Unexpected server error" });
});
const server = createServer(app);
attachConversationRelay(server, config.GEMINI_API_KEY);
server.listen(config.PORT, () => process.stdout.write(`HandsFree backend listening on ${config.PORT}\n`));
