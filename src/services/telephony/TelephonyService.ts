import { config } from "../../config.js";

export interface OutboundCallRequest {
  to: string;
  from: string;
  callbackUrl: string;
  clientState?: string;
}
export interface TelephonyService {
  startOutboundCall(
    request: OutboundCallRequest,
  ): Promise<{ providerCallId: string }>;
  answerCall(callControlId: string): Promise<void>;
  speak(callControlId: string, text: string): Promise<void>;
}

export class TelnyxTelephonyService implements TelephonyService {
  constructor(
    private readonly apiKey = config.TELNYX_API_KEY,
    private readonly connectionId = config.TELNYX_CONNECTION_ID,
  ) {}
  private async command(
    callControlId: string,
    action: "answer" | "speak",
    body: Record<string, unknown> = {},
  ) {
    if (!this.apiKey) throw new Error("Telnyx is not configured");
    const response = await fetch(
      `https://api.telnyx.com/v2/calls/${encodeURIComponent(callControlId)}/actions/${action}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as {
        errors?: Array<{ detail?: string }>;
      } | null;
      throw new Error(
        errorBody?.errors?.[0]?.detail ?? `Telnyx call ${action} failed`,
      );
    }
  }

  async answerCall(callControlId: string) {
    await this.command(callControlId, "answer");
  }
  async speak(callControlId: string, text: string) {
    await this.command(callControlId, "speak", {
      payload: text,
      voice: "female",
      language: "en-US",
    });
  }

  async startOutboundCall(
    request: OutboundCallRequest,
  ): Promise<{ providerCallId: string }> {
    if (!this.apiKey || !this.connectionId)
      throw new Error("Telnyx is not configured");
    const response = await fetch("https://api.telnyx.com/v2/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        connection_id: this.connectionId,
        to: request.to,
        from: request.from,
        webhook_url: request.callbackUrl,
        webhook_url_method: "POST",
        client_state: request.clientState,
      }),
    });
    const body = (await response.json()) as {
      data?: { call_control_id?: string };
      errors?: Array<{ detail?: string }>;
    };
    if (!response.ok || !body.data?.call_control_id)
      throw new Error(
        body.errors?.[0]?.detail ?? "Telnyx could not start the call",
      );
    return { providerCallId: body.data.call_control_id };
  }
}
