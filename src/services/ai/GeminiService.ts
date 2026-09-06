export interface GeminiMessage { role: "user" | "model"; content: string; }
export interface GeminiService {
  respond(messages: GeminiMessage[], systemInstruction: string, signal?: AbortSignal): Promise<string>;
  respondStream(messages: GeminiMessage[], systemInstruction: string, signal?: AbortSignal): AsyncIterable<string>;
}

type GeminiResponse = { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };

export class ConfiguredGeminiService implements GeminiService {
  constructor(private readonly apiKey: string | undefined, private readonly model = "gemini-2.5-flash") {}
  private requestBody(messages: GeminiMessage[], systemInstruction: string) {
    return { systemInstruction: { parts: [{ text: systemInstruction }] }, contents: messages.map((message) => ({ role: message.role, parts: [{ text: message.content }] })), generationConfig: { temperature: 0.4, maxOutputTokens: 180 } };
  }
  async respond(messages: GeminiMessage[], systemInstruction: string, signal?: AbortSignal): Promise<string> {
    if (!this.apiKey) throw new Error("AI service unavailable: GEMINI_API_KEY is not configured");
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`, {
      method: "POST", signal, headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.requestBody(messages, systemInstruction))
    });
    if (!response.ok) throw new Error(`Gemini request failed with status ${response.status}`);
    const payload = await response.json() as GeminiResponse;
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
    if (!text) throw new Error("Gemini returned an empty response");
    return text;
  }

  async *respondStream(messages: GeminiMessage[], systemInstruction: string, signal?: AbortSignal): AsyncIterable<string> {
    if (!this.apiKey) throw new Error("AI service unavailable: GEMINI_API_KEY is not configured");
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.apiKey)}`, {
      method: "POST", signal, headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.requestBody(messages, systemInstruction)),
    });
    if (!response.ok || !response.body) throw new Error(`Gemini streaming request failed with status ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = JSON.parse(line.slice(5).trim()) as GeminiResponse;
          const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
          if (text) yield text;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
