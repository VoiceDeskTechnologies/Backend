import assert from "node:assert/strict";
import test from "node:test";
import { elevenLabsPong, twilioClearEvent, twilioMediaEvent } from "./ConversationRelayService.js";

test("formats ElevenLabs audio as a Twilio media event without transcoding", () => {
  assert.deepEqual(JSON.parse(twilioMediaEvent("MZ123", "base64-ulaw")), {
    event: "media",
    streamSid: "MZ123",
    media: { payload: "base64-ulaw" },
  });
});

test("clears Twilio audio on Speech Engine interruption and answers pings", () => {
  assert.deepEqual(JSON.parse(twilioClearEvent("MZ123")), { event: "clear", streamSid: "MZ123" });
  assert.deepEqual(JSON.parse(elevenLabsPong("ping-1")), { type: "pong", event_id: "ping-1" });
});