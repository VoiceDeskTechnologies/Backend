export interface GeminiMessage { role: "user" | "model"; content: string; }
export interface GeminiService { respond(messages: GeminiMessage[], systemInstruction: string, signal?: AbortSignal): Promise<string>; }

type GeminiResponse = { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };

export class ConfiguredGeminiService implements GeminiService {
  constructor(private readonly apiKey: string | undefined, private readonly model = "gemini-2.5-flash") {}
  async respond(messages: GeminiMessage[], systemInstruction: string, signal?: AbortSignal): Promise<string> {
    if (!this.apiKey) throw new Error("AI service unavailable: GEMINI_API_KEY is not configured");
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey)}`, {
      method: "POST", signal, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: systemInstruction }] }, contents: messages.map((message) => ({ role: message.role, parts: [{ text: message.content }] })), generationConfig: { temperature: 0.4, maxOutputTokens: 180 } })
    });
    if (!response.ok) throw new Error(`Gemini request failed with status ${response.status}`);
    const payload = await response.json() as GeminiResponse;
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
    if (!text) throw new Error("Gemini returned an empty response");
    return text;
  }
}
