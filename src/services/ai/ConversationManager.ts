import type { GeminiMessage, GeminiService } from "./GeminiService.js";

export type ConversationEvent = { type: "prompt"; text: string } | { type: "interrupt" };
export class ConversationManager {
  private readonly messages: GeminiMessage[] = [];
  private activeRequest?: AbortController;
  private turn = Promise.resolve();
  constructor(private readonly gemini: GeminiService, private readonly systemInstruction: string) {}

  prompt(text: string, onResponse: (text: string) => Promise<void>) {
    this.turn = this.turn.then(async () => {
      this.activeRequest = new AbortController();
      this.messages.push({ role: "user", content: text });
      try { const answer = await this.gemini.respond(this.messages, this.systemInstruction, this.activeRequest.signal); this.messages.push({ role: "model", content: answer }); await onResponse(answer); } catch (error) { if (!(error instanceof Error && error.name === "AbortError")) throw error; } finally { this.activeRequest = undefined; }
    });
    return this.turn;
  }

  interrupt() { this.activeRequest?.abort(); }
}