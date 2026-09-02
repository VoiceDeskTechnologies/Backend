import twilio from "twilio";

export interface OutboundCallRequest { to: string; from: string; callbackUrl: string; }
export interface TelephonyService { startOutboundCall(request: OutboundCallRequest): Promise<{ providerCallId: string }>; }

export class TwilioTelephonyService implements TelephonyService {
  private readonly client?: ReturnType<typeof twilio>;
  constructor(accountId: string | undefined, authToken: string | undefined) {
    if (accountId && authToken) this.client = twilio(accountId, authToken);
  }
  async startOutboundCall(request: OutboundCallRequest): Promise<{ providerCallId: string }> {
    if (!this.client) throw new Error("Telephony unavailable: provider credentials are not configured");
    const call = await this.client.calls.create({ to: request.to, from: request.from, url: request.callbackUrl, method: "POST", statusCallback: `${request.callbackUrl}/status`, statusCallbackMethod: "POST", statusCallbackEvent: ["initiated", "ringing", "answered", "completed"] });
    return { providerCallId: call.sid };
  }
}
