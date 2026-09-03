import crypto from "node:crypto";
import { config } from "../../config.js";

export function verifyTelnyxWebhook(
  payload: string,
  signature: string | undefined,
  timestamp: string | undefined,
): boolean {
  if (!config.TELNYX_PUBLIC_KEY || !signature || !timestamp) return false;
  const signedPayload = `${timestamp}|${payload}`;
  try {
    return crypto.verify(
      null,
      Buffer.from(signedPayload),
      config.TELNYX_PUBLIC_KEY,
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}

export function mapTelnyxCallStatus(eventType: string): string | undefined {
  const status: Record<string, string> = {
    "call.initiated": "initiating",
    "call.ringing": "ringing",
    "call.answered": "connected",
    "call.hangup": "completed",
    "call.failed": "failed",
    "call.machine.detection.ended": "connected",
  };
  return status[eventType];
}
