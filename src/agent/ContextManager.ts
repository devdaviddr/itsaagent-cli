import type { Message } from "../types.js";
import { compactMessages, type CompactionMode } from "./compaction.js";

/** Starting chars-per-token estimate; refined per-model via calibrate(). */
const DEFAULT_TOKEN_ESTIMATE_RATIO = 3.5;
/** Each message carries framing tokens (role markers, delimiters) beyond its text. */
const PER_MESSAGE_OVERHEAD = 4;
/** Bounds on the calibrated ratio — guards against degenerate single-call observations. */
const RATIO_MIN = 2.0;
const RATIO_MAX = 6.0;

export class ContextManager {
  private messages: Message[] = [];
  private readonly maxTokens: number;
  /** Chars-per-token ratio, refined as the provider reports real prompt-token counts. */
  private tokenEstimateRatio = DEFAULT_TOKEN_ESTIMATE_RATIO;
  /** Cumulative count of messages evicted since the last clear(). */
  private evictedTotal = 0;
  private onEvict?: (count: number) => void;
  private onUsage?: (usage: { total: number; max: number; ratio: number }) => void;
  /** Deterministic "work so far" digest, folded into the eviction notice so it
   * survives even when raw tool results are trimmed. */
  private summarize?: () => string;
  /** Proactive compaction mode + the fraction of the window that triggers it. */
  private compaction: CompactionMode;
  private compactionThreshold: number;

  constructor(
    maxTokens: number,
    onEvict?: (count: number) => void,
    onUsage?: (usage: { total: number; max: number; ratio: number }) => void,
    summarize?: () => string,
    compaction: CompactionMode = "off",
    compactionThreshold = 0.8,
  ) {
    this.maxTokens = maxTokens;
    this.onEvict = onEvict;
    this.onUsage = onUsage;
    this.summarize = summarize;
    this.compaction = compaction;
    this.compactionThreshold = compactionThreshold;
  }

  add(msg: Omit<Message, "timestamp">): void {
    this.messages.push({ ...msg, timestamp: Date.now() });
    // Proactively compress (shrink old tool results, drop superseded reads) once
    // the window is filling, so we keep meaning instead of evicting whole turns.
    if (this.compaction !== "off" && this.totalTokens() / this.maxTokens >= this.compactionThreshold) {
      this.runCompaction();
    }
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

  /** Replace all messages — used to restore a saved session. */
  load(messages: Message[]): void {
    this.messages = messages.map((m) => ({ ...m }));
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
    return Math.ceil(text.length / this.tokenEstimateRatio);
  }

  /**
   * Refine the chars-per-token ratio from a real prompt-token count reported by
   * the provider. Uses a light EMA so a single noisy observation can't swing the
   * estimate, and clamps to a sane band. Best-effort; a non-positive token count
   * (provider didn't report) is ignored.
   */
  calibrate(charsSent: number, actualPromptTokens: number): void {
    if (actualPromptTokens > 0 && charsSent > 0) {
      const observed = charsSent / actualPromptTokens;
      const next = this.tokenEstimateRatio * 0.7 + observed * 0.3;
      this.tokenEstimateRatio = Math.min(RATIO_MAX, Math.max(RATIO_MIN, next));
    }
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
    if (msg.pinned) return true;
    if (index === this.firstTaskIndex()) return true;
    return false;
  }

  /** The older (non-pinned, non-recent) messages as text — input for summarization. */
  olderMessagesText(recentWindow: number): { text: string; count: number } {
    const recentStart = Math.max(0, this.messages.length - recentWindow);
    const parts: string[] = [];
    this.messages.forEach((m, i) => {
      if (this.isPinned(m, i) || i >= recentStart) return;
      parts.push(`[${m.role}] ${m.content}`);
    });
    return { text: parts.join("\n\n"), count: parts.length };
  }

  /** Replace the older messages with a single pinned conversation summary. */
  foldOlder(summary: string, recentWindow: number): boolean {
    const recentStart = Math.max(0, this.messages.length - recentWindow);
    let removed = 0;
    const kept: Message[] = [];
    this.messages.forEach((m, i) => {
      if (!this.isPinned(m, i) && i < recentStart) {
        removed++;
        return;
      }
      kept.push(m);
    });
    if (removed === 0) return false;
    const summaryMsg: Message = {
      role: "user",
      content: `[CONVERSATION SUMMARY of ${removed} earlier message(s)]\n${summary}`,
      timestamp: Date.now(),
      pinned: true,
    };
    // Insert right after the original task (first non-notice user message), else after system.
    const taskPos = kept.findIndex((m) => m.role === "user" && !m.notice && !m.pinned);
    kept.splice(taskPos === -1 ? Math.min(1, kept.length) : taskPos + 1, 0, summaryMsg);
    this.messages = kept;
    return true;
  }

  /** Structured compaction: shrink old tool results / drop superseded reads in place. */
  private runCompaction(): void {
    const { messages, changed } = compactMessages(this.messages, (i) => this.isPinned(this.messages[i], i));
    if (changed) this.messages = messages;
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
