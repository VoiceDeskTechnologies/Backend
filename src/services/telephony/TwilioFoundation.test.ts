import assert from "node:assert/strict";
import test from "node:test";
import { TwilioProvider } from "./TwilioProvider.js";

test("rejects Twilio webhook validation without a signature", () => {
  const request = { header: () => undefined, originalUrl: "/test", body: {} } as never;
  assert.equal(TwilioProvider.validateWebhook(request, "test-token"), false);
});

test("creates an outbound Twilio call through the official client", async () => {
  const provider = new TwilioProvider("AC00000000000000000000000000000000", "test-token");
  const calls = (provider as unknown as { client: { calls: { create: (input: Record<string, unknown>) => Promise<{ sid: string }> } } }).client.calls;
  const originalCreate = calls.create;
  calls.create = async (input) => {
    assert.equal(input.to, "+14155550123");
    assert.equal(input.from, "+14155550124");
    return { sid: "CA00000000000000000000000000000000" };
  };
  try {
    const result = await provider.startOutboundCall({
      to: "+14155550123",
      from: "+14155550124",
      answerUrl: "https://example.test/api/telephony/twilio/answer/call-1",
      statusCallbackUrl: "https://example.test/api/telephony/twilio/status",
      mediaStreamUrl: "wss://example.test/api/telephony/twilio/media-stream",
    });
    assert.equal(result.providerCallId, "CA00000000000000000000000000000000");
  } finally {
    calls.create = originalCreate;
  }
});