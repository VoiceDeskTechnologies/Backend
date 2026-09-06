# HandsFree calling pipeline

The active telephony provider is Twilio. The backend owns call records, authorization, agent context, Gemini reasoning, and usage; ElevenLabs Speech Engine owns realtime speech recognition, turn-taking, interruption handling, and speech synthesis.

```text
PSTN caller
  -> Twilio POST /api/telephony/twilio/incoming or outbound answer URL
  -> Twilio bidirectional Media Stream WS /api/telephony/twilio/media-stream
  -> ElevenLabs Speech Engine WS /api/voice/speech-engine/ws
  -> Gemini custom LLM response
  -> ElevenLabs synthesized voice
  -> Twilio ulaw_8000 media
```

## Active endpoints

- `POST /api/telephony/twilio/incoming`: validates `X-Twilio-Signature`, resolves the called number to its owner and agent, creates the inbound call, and returns bidirectional-stream TwiML.
- `POST /api/telephony/twilio/answer/:callId`: validates the webhook, marks the outbound call answered, and returns stream TwiML.
- `POST /api/telephony/twilio/status`: validates status callbacks and updates lifecycle and duration from Twilio.
- `WS /api/telephony/twilio/media-stream`: parses Twilio `connected`, `start`, `media`, `dtmf`, `stop`, and `mark` events and correlates each stream to its call.
- `WS /api/voice/speech-engine/ws`: attached with the official ElevenLabs SDK. ElevenLabs authenticates the connection and sends transcript history to the Gemini adapter.

## Configuration

Backend-only variables are documented in `.env.example`: Twilio account credentials, `PUBLIC_URL`/`PUBLIC_WS_URL`, `VOICE_PROVIDER_API_KEY`, `ELEVENLABS_SPEECH_ENGINE_ID`, `ELEVENLABS_SHARED_SECRET`, and `GEMINI_API_KEY`. Never expose these through frontend environment variables.

Number provisioning is idempotent through `phone_number_provisioning_jobs`. Twilio SIDs are stored in `phone_numbers.twilio_phone_number_sid`; the authenticated user's active default number is always used as outbound caller ID.

## Verification

`npm run build` type-checks the backend and `npm test` runs the focused Twilio provider tests. A real end-to-end call still requires configured Twilio, ElevenLabs Speech Engine, Gemini, Supabase, public HTTPS/WSS endpoints, and a live test call. No local test claims to validate that external loop.
