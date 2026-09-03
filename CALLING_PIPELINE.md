# HandsFree calling pipeline

HandsFree uses Telnyx Call Control and a per-call WebSocket relay, with the following production boundaries:

```text
PSTN caller
  -> Telnyx webhook POST /telnyx/webhook
  -> Telnyx call media/WebSocket connection
  -> one WebSocket per call
  -> ConversationRelay performs speech recognition, turn detection, TTS, and barge-in
  -> ConversationManager owns only this call's history and state
  -> GeminiService sends short, cancellable async requests
  -> text response immediately returns to ConversationRelay as { type: "text", last: true }
  -> Telnyx speaks or streams it to the caller
```

## Low-latency rules

1. Keep STT and TTS in ConversationRelay. Do not send raw audio through the application unless a later provider requires it.
2. Never call a synchronous SDK method from the WebSocket event loop. The Python sample's `chat_session.send_message` blocks the loop; HandsFree uses `fetch` with an `AbortController`.
3. Keep one `ConversationManager` per call. Never use a process-wide chat session or history.
4. Serialize prompts per call. A caller can produce overlapping prompt events; a turn queue prevents response ordering corruption.
5. Abort Gemini work on an interrupt or socket close. ConversationRelay stops the current speech; the backend must also cancel the pending model request.
6. Keep the system prompt small. Load agent settings and only relevant knowledge before the call, then send the minimum context needed per turn.
7. Persist call events asynchronously. A database write must never delay a text response. Use an event queue/outbox for transcripts, summaries, usage, and provider cost records.
8. Use provider status callbacks for call lifecycle state. The WebSocket is for conversation state, not the source of truth for billing duration.

## Current backend entry points

- `POST /api/webhooks/telnyx`: verifies Telnyx Ed25519 signatures, deduplicates events, creates inbound call records, answers test calls, and reconciles call-control status. `/telnyx/webhook` remains an alias.
- `WS /ws`: creates a per-call conversation and handles `setup`, `prompt`, and `interrupt` messages.
- `TelnyxTelephonyService`: creates outbound calls through Telnyx Call Control and uses the configured HandsFree caller ID.
- `GeminiService`: server-only Gemini adapter with a short output cap and request cancellation.

The Telnyx foundation tests run with `npm test`. They mock provider HTTP calls and never place a paid call.

## Recommended production sequence

1. Authenticate the user and validate the agent, assigned number, destination, entitlement, and usage reservation in one backend transaction.
2. Insert the call as `queued`, then call Telnyx with the public webhook URL.
3. Update lifecycle state only from verified Telnyx callbacks and append immutable `call_events`.
4. On relay setup, load the call's agent context by provider call ID. Build the disclosure/greeting from the stored agent and user setting.
5. On each prompt, run the constrained agent tool policy, retrieve only relevant knowledge, call Gemini, and return text immediately.
6. On completion, reconcile actual provider duration, append usage ledger entries, generate the summary asynchronously, and notify the user.

## Latency target

ConversationRelay handles the audio path. The application target for a normal turn is: prompt received to first response text in under two seconds, with Gemini streaming (`streamGenerateContent`) as the next optimization when partial text delivery is needed. The current adapter is cancellable but returns a complete response, so it is correct and non-blocking, not yet token-streaming.