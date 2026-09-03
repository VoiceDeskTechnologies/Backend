import { WebSocketServer, type WebSocket } from "ws";
import { ConfiguredGeminiService } from "../ai/GeminiService.js";
import { ConversationManager } from "../ai/ConversationManager.js";

type RelayMessage = { type: string; callControlId?: string; voicePrompt?: string };
export function attachConversationRelay(server: import("http").Server, apiKey: string | undefined) {
  const websocketServer = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => { if (request.url !== "/ws") { socket.destroy(); return; } websocketServer.handleUpgrade(request, socket, head, (websocket) => websocketServer.emit("connection", websocket, request)); });
  websocketServer.on("connection", (websocket: WebSocket) => {
    let manager: ConversationManager | undefined;
    websocket.on("message", (raw) => { void handleMessage(websocket, raw.toString(), apiKey, manager).then((value) => { manager = value; }); });
    websocket.on("close", () => manager?.interrupt());
  });
}

async function handleMessage(websocket: WebSocket, raw: string, apiKey: string | undefined, manager?: ConversationManager): Promise<ConversationManager | undefined> {
  let message: RelayMessage; try { message = JSON.parse(raw) as RelayMessage; } catch { return manager; }
  if (message.type === "setup") return new ConversationManager(new ConfiguredGeminiService(apiKey), "You are a concise, natural phone agent. Speak plainly, use no markdown, ask one question at a time, and never claim an action you did not complete.");
  if (message.type === "interrupt") { manager?.interrupt(); return manager; }
  if (message.type === "prompt" && message.voicePrompt && manager) await manager.prompt(message.voicePrompt, async (text) => { if (websocket.readyState === websocket.OPEN) websocket.send(JSON.stringify({ type: "text", token: text, last: true })); });
  return manager;
}