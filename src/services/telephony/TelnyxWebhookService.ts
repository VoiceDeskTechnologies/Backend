import crypto from "node:crypto";
import { config } from "../../config.js";

export function verifyTelnyxWebhook(
  payload: string,
  signature: string | undefined,
  timestamp: string | undefined,
  publicKey = config.TELNYX_PUBLIC_KEY,
): boolean {
  if (!publicKey || !signature || !timestamp) return false;
  const timestampSeconds = Number(timestamp);
  if (
    !Number.isFinite(timestampSeconds) ||
    Math.abs(Date.now() / 1000 - timestampSeconds) > 300
  )
    return false;
  const signedPayload = `${timestamp}|${payload}`;
  try {
    return crypto.verify(
      null,
      Buffer.from(signedPayload),
      publicKey,
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}

export function mapTelnyxCallStatus(eventType: string): string | undefined {
  const status: Record<string, string> = {
    "call.initiated": "queued",
    "call.ringing": "ringing",
    "call.answered": "connected",
    "call.hangup": "completed",
    "call.failed": "failed",
    "call.machine.detection.ended": "connected",
  };
  return status[eventType];
}

export type TelnyxCallEvent = {
  data?: {
    id?: string;
    event_type?: string;
    payload?: {
      call_control_id?: string;
      call_session_id?: string;
      direction?: "incoming" | "outgoing";
      from?: string;
      to?: string;
      start_time?: string;
      answered_at?: string;
      end_time?: string;
      hangup_cause?: string;
      failure_reason?: string;
    };
  };
};
