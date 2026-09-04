import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { config } from "../../config.js";

export class ElevenLabsVoiceService {
  private readonly client: ElevenLabsClient;

  constructor(
    apiKey = config.VOICE_PROVIDER_API_KEY,
    private readonly voiceId = config.VOICE_PROVIDER_VOICE_ID,
    private readonly modelId = config.VOICE_PROVIDER_MODEL_ID,
  ) {
    if (!apiKey) throw new Error("ElevenLabs voice provider is not configured");
    this.client = new ElevenLabsClient({ apiKey });
  }

  async synthesize(text: string): Promise<Buffer> {
    if (!this.voiceId) throw new Error("VOICE_PROVIDER_VOICE_ID is not configured");
    const audioStream = await this.client.textToSpeech.convert(this.voiceId, {
      text,
      modelId: this.modelId,
      outputFormat: "mp3_44100_128",
    });
    const reader = audioStream.getReader();
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  }
}
