import { WebSocket, WebSocketServer, type RawData } from "ws";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { config } from "../../config.js";
import { ConfiguredGeminiService } from "../ai/GeminiService.js";

type TwilioMediaMessage = {
  event: "connected" | "start" | "media" | "dtmf" | "stop" | "mark";
  start?: { streamSid?: string; callSid?: string; customParameters?: Record<string, string> };
  media?: { payload?: string };
};

type ElevenLabsEvent = {
  type?: string;
  audio_event?: { audio_base_64?: string };
  ping_event?: { event_id?: string };
};

async function signedConversationUrl(elevenlabs: ElevenLabsClient) {
  if (!config.ELEVENLABS_SPEECH_ENGINE_ID) throw new Error("ELEVENLABS_SPEECH_ENGINE_ID is not configured");
  const response = await elevenlabs.conversationalAi.conversations.getSignedUrl({ agentId: config.ELEVENLABS_SPEECH_ENGINE_ID });
  return response.signedUrl;
}

function parse(raw: RawData) {
  return JSON.parse(raw.toString()) as TwilioMediaMessage;
}

export function twilioMediaEvent(streamSid: string, payload: string) {
  return JSON.stringify({ event: "media", streamSid, media: { payload } });
}

export function twilioClearEvent(streamSid: string) {
  return JSON.stringify({ event: "clear", streamSid });
}

export function elevenLabsPong(eventId: string) {
  return JSON.stringify({ type: "pong", event_id: eventId });
}

function sendTwilioMedia(twilioWs: WebSocket, streamSid: string, payload: string) {
  if (twilioWs.readyState !== WebSocket.OPEN) return;
  twilioWs.send(twilioMediaEvent(streamSid, payload));
}

async function openElevenLabsConversation(twilioWs: WebSocket, elevenlabs: ElevenLabsClient, getStreamSid: () => string | undefined) {
  const elevenLabsWs = new WebSocket(await signedConversationUrl(elevenlabs));
  await new Promise<void>((resolve, reject) => {
    const onOpen = () => { cleanup(); resolve(); };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const cleanup = () => { elevenLabsWs.off("open", onOpen); elevenLabsWs.off("error", onError); };
    elevenLabsWs.once("open", onOpen);
    elevenLabsWs.once("error", onError);
  });
  elevenLabsWs.send(JSON.stringify({ type: "conversation_initiation_client_data" }));
  elevenLabsWs.on("message", (raw) => {
    let event: ElevenLabsEvent;
    try { event = JSON.parse(raw.toString()) as ElevenLabsEvent; } catch { return; }
    const streamSid = getStreamSid();
    if (!streamSid) return;
    if (event.type === "audio" && event.audio_event?.audio_base_64) {
      sendTwilioMedia(twilioWs, streamSid, event.audio_event.audio_base_64);
    } else if (event.type === "interruption" && twilioWs.readyState === WebSocket.OPEN) {
      twilioWs.send(twilioClearEvent(streamSid));
    } else if (event.type === "ping" && event.ping_event?.event_id) {
      elevenLabsWs.send(elevenLabsPong(event.ping_event.event_id));
    }
  });
  return elevenLabsWs;
}

export async function attachSpeechEngine(server: import("http").Server) {
  if (!config.VOICE_PROVIDER_API_KEY || !config.ELEVENLABS_SPEECH_ENGINE_ID || !config.ELEVENLABS_SHARED_SECRET) {
    console.warn(JSON.stringify({ service: "speech-engine", status: "not_configured" }));
    return;
  }
  const elevenlabs = new ElevenLabsClient({ apiKey: config.VOICE_PROVIDER_API_KEY });
  const publicWebSocketUrl = config.PUBLIC_WS_URL ?? config.PUBLIC_URL?.replace(/^http/, "ws");
  if (publicWebSocketUrl) {
    await elevenlabs.speechEngine.update(config.ELEVENLABS_SPEECH_ENGINE_ID, {
      asr: { userInputAudioFormat: "ulaw_8000" },
      tts: { modelId: "eleven_flash_v2", agentOutputAudioFormat: "ulaw_8000" },
      speechEngine: {
        wsUrl: `${publicWebSocketUrl.replace(/\/$/, "")}/api/voice/speech-engine/ws`,
        requestHeaders: { "x-api-key": config.ELEVENLABS_SHARED_SECRET },
      },
    });
  }
  server.on("upgrade", (request, socket) => {
    if (request.url !== "/api/voice/speech-engine/ws") return;
    if (request.headers["x-api-key"] !== config.ELEVENLABS_SHARED_SECRET) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
    }
  });
  await elevenlabs.speechEngine.attach(config.ELEVENLABS_SPEECH_ENGINE_ID, server, "/api/voice/speech-engine/ws", {
    onTranscript: async (transcript, signal, session) => {
      const messages = transcript.map((message) => ({ role: message.role === "agent" ? "model" as const : "user" as const, content: message.content }));
      const response = new ConfiguredGeminiService(config.GEMINI_API_KEY).respondStream(messages, "You are a concise, natural phone agent. Speak plainly, ask one question at a time, and never claim an action you did not complete.", signal);
      await session.sendResponse(response);
    },
    onError: (error) => console.error(JSON.stringify({ service: "speech-engine", status: "error", error: String(error) })),
  });
}

export function attachConversationRelay(server: import("http").Server) {
  const websocketServer = new WebSocketServer({ noServer: true });
  const elevenlabs = config.VOICE_PROVIDER_API_KEY ? new ElevenLabsClient({ apiKey: config.VOICE_PROVIDER_API_KEY }) : undefined;
  server.on("upgrade", (request, socket, head) => {
    if (request.url !== "/api/telephony/twilio/media-stream") return;
    websocketServer.handleUpgrade(request, socket, head, (websocket) => websocketServer.emit("connection", websocket));
  });
  websocketServer.on("connection", (twilioWs: WebSocket) => {
    let streamSid: string | undefined;
    let elevenLabsWs: WebSocket | undefined;
    let opening: Promise<WebSocket | undefined> | undefined;
    const closeElevenLabs = () => {
      if (elevenLabsWs && elevenLabsWs.readyState < WebSocket.CLOSING) elevenLabsWs.close();
      elevenLabsWs = undefined;
    };
    twilioWs.on("message", (raw) => {
      let event: TwilioMediaMessage;
      try { event = parse(raw); } catch { twilioWs.close(1003, "Invalid media stream message"); return; }
      if (event.event === "start") {
        streamSid = event.start?.streamSid;
        if (!elevenlabs || !streamSid) { twilioWs.close(1011, "Speech Engine is not configured"); return; }
        opening = openElevenLabsConversation(twilioWs, elevenlabs, () => streamSid).then((ws) => { elevenLabsWs = ws; return ws; }).catch((error: Error) => { console.error(JSON.stringify({ service: "speech-engine", status: "conversation_open_failed", error: error.message })); twilioWs.close(1011, "Speech Engine unavailable"); return undefined; });
      } else if (event.event === "media" && event.media?.payload && opening) {
        void opening.then((ws) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ user_audio_chunk: event.media?.payload })); });
      } else if (event.event === "stop") {
        closeElevenLabs();
        twilioWs.close();
      }
    });
    twilioWs.on("close", closeElevenLabs);
    twilioWs.on("error", closeElevenLabs);
  });
}
