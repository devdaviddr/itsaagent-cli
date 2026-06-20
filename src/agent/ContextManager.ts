import type { Message } from "../types.js";

const TOKEN_ESTIMATE_RATIO = 3.5;
/** Each message carries framing tokens (role markers, delimiters) beyond its text. */
const PER_MESSAGE_OVERHEAD = 4;

export class ContextManager {
  private messages: Message[] = [];
  private readonly maxTokens: number;
  /** Cumulative count of messages evicted since the last clear(). */
  private evictedTotal = 0;
  private onEvict?: (count: number) => void;
  private onUsage?: (usage: { total: number; max: number; ratio: number }) => void;
  /** Deterministic "work so far" digest, folded into the eviction notice so it
   * survives even when raw tool results are trimmed. */
  private summarize?: () => string;

  constructor(
    maxTokens: number,
    onEvict?: (count: number) => void,
    onUsage?: (usage: { total: number; max: number; ratio: number }) => void,
    summarize?: () => string,
  ) {
    this.maxTokens = maxTokens;
    this.onEvict = onEvict;
    this.onUsage = onUsage;
    this.summarize = summarize;
  }

  add(msg: Omit<Message, "timestamp">): void {
    this.messages.push({ ...msg, timestamp: Date.now() });
    const evicted = this.trim();
    if (evicted > 0) {
      this.evictedTotal += evicted;
      this.upsertNotice();
      this.onEvict?.(evicted);
    }
    this.onUsage?.(this.usage());
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
    this.evictedTotal = 0;
  }

  /** Fully reset the context to a single fresh system message (used on agent handoff). */
  reset(systemContent: string): void {
    this.messages = [{ role: "system", content: systemContent, timestamp: Date.now() }];
    this.evictedTotal = 0;
  }

  /** Replace the system prompt in place, preserving all conversation history.
   * Used to rebuild the prompt once the model's native-tool capability is known. */
  setSystemPrompt(content: string): void {
    const first = this.messages[0];
    if (first && first.role === "system") {
      this.messages[0] = { role: "system", content, timestamp: first.timestamp };
    } else {
      this.messages.unshift({ role: "system", content, timestamp: Date.now() });
    }
  }

  usage(): { total: number; max: number; ratio: number } {
    const total = this.totalTokens();
    return { total, max: this.maxTokens, ratio: Math.round((total / this.maxTokens) * 100) };
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / TOKEN_ESTIMATE_RATIO);
  }

  private totalTokens(): number {
    return this.messages.reduce((sum, m) => sum + this.estimateTokens(m.content) + PER_MESSAGE_OVERHEAD, 0);
  }

  /** Index of the first non-notice user message (the original task), or -1. */
  private firstTaskIndex(): number {
    return this.messages.findIndex((m) => m.role === "user" && !m.notice);
  }

  /** A message is pinned (never evicted) if it's the system prompt, the original task, or a notice. */
  private isPinned(msg: Message, index: number): boolean {
    if (msg.role === "system") return true;
    if (msg.notice) return true;
    if (index === this.firstTaskIndex()) return true;
    return false;
  }

  /** Evict oldest non-pinned messages until within budget. Returns count evicted. */
  private trim(): number {
    let evicted = 0;
    while (this.totalTokens() > this.maxTokens) {
      const idx = this.messages.findIndex((m, i) => !this.isPinned(m, i));
      if (idx === -1) break; // only pinned messages remain
      this.messages.splice(idx, 1);
      evicted++;
    }
    return evicted;
  }

  /**
   * Insert or update the single context-eviction notice. Placed right after the
   * original task so the model sees it early. The notice is pinned and is never
   * written to the session log (it carries the `notice` flag).
   */
  private upsertNotice(): void {
    let content =
      `[CONTEXT NOTICE: ${this.evictedTotal} message(s) were trimmed to stay within the ` +
      `context window. The original task and the most recent results are preserved.]`;

    // Fold in the deterministic "work so far" digest so what was done survives
    // even after the raw tool results that produced it are evicted.
    const digest = this.summarize?.();
    if (digest && !digest.startsWith("- (nothing")) {
      content += `\nWork so far (full record retained even though raw output was trimmed):\n${digest}`;
    }

    const existing = this.messages.find((m) => m.notice);
    if (existing) {
      existing.content = content;
      return;
    }

    const taskIdx = this.firstTaskIndex();
    const insertAt = taskIdx === -1 ? this.messages.length : taskIdx + 1;
    this.messages.splice(insertAt, 0, { role: "user", content, timestamp: Date.now(), notice: true });
  }
}
