import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import {
  mapTelnyxCallStatus,
  verifyTelnyxWebhook,
} from "./TelnyxWebhookService.js";
import { TelnyxTelephonyService } from "./TelephonyService.js";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const testPublicKey = publicKey
  .export({ type: "spki", format: "pem" })
  .toString();

test("accepts a current valid Telnyx signature", () => {
  const payload = JSON.stringify({ data: { event_type: "call.answered" } });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = sign(
    null,
    Buffer.from(`${timestamp}|${payload}`),
    privateKey,
  ).toString("base64");
  assert.equal(
    verifyTelnyxWebhook(payload, signature, timestamp, testPublicKey),
    true,
  );
});

test("rejects invalid, stale, and malformed signatures", () => {
  const payload = "{}";
  const timestamp = String(Math.floor(Date.now() / 1000) - 301);
  assert.equal(
    verifyTelnyxWebhook(payload, "invalid", timestamp, testPublicKey),
    false,
  );
  assert.equal(verifyTelnyxWebhook("not-json", undefined, undefined), false);
});

test("normalizes supported Telnyx call events", () => {
  assert.equal(mapTelnyxCallStatus("call.initiated"), "queued");
  assert.equal(mapTelnyxCallStatus("call.ringing"), "ringing");
  assert.equal(mapTelnyxCallStatus("call.answered"), "connected");
  assert.equal(mapTelnyxCallStatus("call.hangup"), "completed");
  assert.equal(mapTelnyxCallStatus("call.failed"), "failed");
  assert.equal(mapTelnyxCallStatus("unknown.event"), undefined);
});

test("creates an outbound Telnyx call through the Call Control API", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.method, "POST");
    assert.match(String(init?.body), /test-connection/);
    return new Response(
      JSON.stringify({ data: { call_control_id: "call-control-1" } }),
      { status: 201 },
    );
  };
  try {
    const result = await new TelnyxTelephonyService(
      "test-key",
      "test-connection",
    ).startOutboundCall({
      to: "+14155550123",
      from: "+14155550124",
      callbackUrl: "https://example.test/api/webhooks/telnyx",
    });
    assert.equal(result.providerCallId, "call-control-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
