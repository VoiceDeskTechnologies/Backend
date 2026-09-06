import twilio from "twilio";
import type { Request } from "express";
import { config } from "../../config.js";
import type { OutboundCallRequest, TelephonyService } from "./TelephonyService.js";

export class TwilioProviderError extends Error {
  constructor(readonly code: string, message: string, readonly providerStatus?: number) {
    super(message);
    this.name = "TwilioProviderError";
  }
}

export class TwilioProvider implements TelephonyService {
  private readonly client;

  constructor(
    accountSid = config.TWILIO_ACCOUNT_SID,
    authToken = config.TWILIO_AUTH_TOKEN,
  ) {
    if (!accountSid || !authToken)
      throw new TwilioProviderError("TWILIO_AUTH_ERROR", "Twilio is not configured");
    this.client = twilio(accountSid, authToken);
  }

  async startOutboundCall(request: OutboundCallRequest) {
    try {
      const call = await this.client.calls.create({
        to: request.to,
        from: request.from,
        url: request.answerUrl,
        method: "POST",
        statusCallback: request.statusCallbackUrl,
        statusCallbackMethod: "POST",
        statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
        machineDetection: "Enable",
        timeLimit: request.maxDurationSeconds,
      });
      return { providerCallId: call.sid };
    } catch (error) {
      const providerError = error as { code?: number; status?: number; message?: string };
      throw new TwilioProviderError(
        "TWILIO_CALL_FAILED",
        providerError.message ?? "Twilio could not start the call",
        providerError.status,
      );
    }
  }

  async searchNumbers(countryCode = "US", areaCode?: string) {
    if (!/^[A-Z]{2}$/.test(countryCode))
      throw new TwilioProviderError("TWILIO_DESTINATION_ERROR", "Country code must be ISO alpha-2");
    return this.client.availablePhoneNumbers(countryCode).local.list({
      areaCode: areaCode ? Number(areaCode) : undefined,
      voiceEnabled: true,
      pageSize: 20,
    });
  }

  async provisionNumber(phoneNumber: string, voiceUrl: string, statusCallbackUrl: string) {
    try {
      return await this.client.incomingPhoneNumbers.create({
        phoneNumber,
        voiceUrl,
        voiceMethod: "POST",
        statusCallback: statusCallbackUrl,
        statusCallbackMethod: "POST",
      });
    } catch (error) {
      const providerError = error as { status?: number; message?: string };
      throw new TwilioProviderError(
        "TWILIO_NUMBER_UNAVAILABLE",
        providerError.message ?? "Twilio could not provision the number",
        providerError.status,
      );
    }
  }

  async configureNumber(sid: string, voiceUrl: string, statusCallbackUrl: string) {
    return this.client.incomingPhoneNumbers(sid).update({
      voiceUrl,
      voiceMethod: "POST",
      statusCallback: statusCallbackUrl,
      statusCallbackMethod: "POST",
    });
  }

  async getNumber(sid: string) {
    return this.client.incomingPhoneNumbers(sid).fetch();
  }

  async listOwnedNumbers() {
    return this.client.incomingPhoneNumbers.list({ pageSize: 100 });
  }

  async releaseNumber(sid: string) {
    await this.client.incomingPhoneNumbers(sid).remove();
  }

  static validateWebhook(request: Request, authToken = config.TWILIO_AUTH_TOKEN) {
    if (!authToken) return false;
    const signature = request.header("x-twilio-signature");
    if (!signature) return false;
    const url = `${config.PUBLIC_URL ?? ""}${request.originalUrl}`;
    return twilio.validateRequest(authToken, signature, url, request.body);
  }
}