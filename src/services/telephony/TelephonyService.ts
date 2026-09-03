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
}

export class TelnyxTelephonyService implements TelephonyService {
  async startOutboundCall(
    request: OutboundCallRequest,
  ): Promise<{ providerCallId: string }> {
    if (!config.TELNYX_API_KEY || !config.TELNYX_CONNECTION_ID)
      throw new Error("Telnyx is not configured");
    const response = await fetch("https://api.telnyx.com/v2/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.TELNYX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        connection_id: config.TELNYX_CONNECTION_ID,
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
