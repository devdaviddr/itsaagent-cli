import type { Message } from "../types.js";

const TOKEN_ESTIMATE_RATIO = 3.5;

export class ContextManager {
  private messages: Message[] = [];
  private readonly maxTokens: number;

  constructor(maxTokens: number) {
    this.maxTokens = maxTokens;
  }

  add(msg: Omit<Message, "timestamp">): void {
    this.messages.push({ ...msg, timestamp: Date.now() });
    this.trim();
  }

  get(): Message[] {
    return [...this.messages];
  }

  /** Returns messages without internal metadata for provider consumption. */
  forProvider(): Array<{ role: string; content: string }> {
    return this.messages.map((m) => ({ role: m.role, content: m.content }));
  }

  clear(): void {
    const system = this.messages.find((m) => m.role === "system");
    this.messages = system ? [system] : [];
  }

  usage(): { total: number; max: number; ratio: number } {
    const total = this.totalTokens();
    return { total, max: this.maxTokens, ratio: Math.round((total / this.maxTokens) * 100) };
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / TOKEN_ESTIMATE_RATIO);
  }

  private totalTokens(): number {
    return this.messages.reduce((sum, m) => sum + this.estimateTokens(m.content), 0);
  }

  private trim(): void {
    while (this.totalTokens() > this.maxTokens && this.messages.length > 3) {
      // Pin index 0 (system prompt) and index 1 (original user task) — evict from index 2 onward
      const idx = this.messages.findIndex((_, i) => i > 1);
      if (idx === -1) break;
      this.messages.splice(idx, 1);
    }
  }
}
