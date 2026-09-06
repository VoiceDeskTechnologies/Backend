export interface OutboundCallRequest {
  to: string;
  from: string;
  answerUrl: string;
  statusCallbackUrl: string;
  mediaStreamUrl: string;
  maxDurationSeconds?: number;
  clientState?: string;
}
export interface TelephonyService {
  startOutboundCall(
    request: OutboundCallRequest,
  ): Promise<{ providerCallId: string }>;
}
