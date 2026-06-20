import { ProviderError } from "../agent/errors.js";
import type { ProviderConfig, StreamChunk, ToolCall, ToolSpec } from "../types.js";
import type { ChatMessage, ModelInfo, Provider } from "./Provider.js";

interface OllamaToolCall {
  function?: { name?: string; arguments?: Record<string, unknown> | string };
}

interface OllamaStreamChunk {
  message?: { content?: string; tool_calls?: OllamaToolCall[] };
  done: boolean;
}

interface OllamaModel {
  name: string;
  size: number;
}

/** Convert Ollama's tool_calls into the runtime's ToolCall shape. */
function normaliseToolCalls(raw: OllamaToolCall[] | undefined): ToolCall[] {
  if (!raw) return [];
  const out: ToolCall[] = [];
  for (const tc of raw) {
    const name = tc.function?.name;
    if (typeof name !== "string") continue;
    let args: Record<string, unknown> = {};
    const a = tc.function?.arguments;
    if (typeof a === "string") {
      try { args = JSON.parse(a) as Record<string, unknown>; } catch { args = {}; }
    } else if (a && typeof a === "object") {
      args = a;
    }
    out.push({ name, args });
  }
  return out;
}

export class OllamaProvider implements Provider {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly temperature: number;
  private readonly maxTokens: number;
  private readonly numCtx?: number;
  private readonly stop?: string[];

  /** Bounded retries with backoff — local servers are flaky on cold model loads. */
  private static readonly MAX_RETRIES = 2;

  constructor(config: ProviderConfig) {
    this.baseUrl = config.baseUrl;
    this.model = config.model;
    this.temperature = config.temperature;
    this.maxTokens = config.maxTokens;
    this.numCtx = config.numCtx;
    this.stop = config.stop;
  }

  async *stream(messages: ChatMessage[], tools?: ToolSpec[]): AsyncGenerator<StreamChunk> {
    const useTools = Array.isArray(tools) && tools.length > 0;
    const body = JSON.stringify({
      model: this.model,
      messages,
      // Always stream so responses render token-by-token; tool_calls are
      // accumulated across the streamed chunks below.
      stream: true,
      options: {
        temperature: this.temperature,
        num_predict: this.maxTokens,
        // Request the full window we manage client-side; without this Ollama
        // uses the model's small default and silently truncates our context.
        ...(this.numCtx ? { num_ctx: this.numCtx } : {}),
        ...(this.stop && this.stop.length > 0 ? { stop: this.stop } : {}),
      },
      ...(useTools ? { tools } : {}),
    });

    // Retry the connection on transient failures (refused, dropped, 5xx) — the
    // first call after a model swap/cold load often fails before the model is warm.
    let response: Response | undefined;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= OllamaProvider.MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(`${this.baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
        if (res.status >= 500) {
          lastErr = new ProviderError(`Ollama error (${res.status}): ${await res.text()}`, res.status);
        } else {
          response = res;
          break;
        }
      } catch (err: unknown) {
        lastErr = new ProviderError(`Cannot reach Ollama at ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (attempt < OllamaProvider.MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 400 * Math.pow(2, attempt)));
      }
    }
    if (!response) throw lastErr instanceof Error ? lastErr : new ProviderError(String(lastErr));

    if (!response.ok || !response.body) {
      throw new ProviderError(`Ollama error (${response.status}): ${await response.text()}`, response.status);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const toolCalls: ToolCall[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const chunk = JSON.parse(trimmed) as OllamaStreamChunk;
            // Collect any tool calls that appear in this chunk.
            const calls = normaliseToolCalls(chunk.message?.tool_calls);
            if (calls.length > 0) toolCalls.push(...calls);
            const content = chunk.message?.content ?? "";
            if (chunk.done) {
              if (content) yield { delta: content, done: false };
              yield { delta: "", done: true, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
            } else if (content) {
              yield { delta: content, done: false };
            }
          } catch { /* skip malformed NDJSON lines */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(`${this.baseUrl}/api/tags`);
    if (!res.ok) throw new ProviderError(`Failed to list models: ${res.status}`, res.status);
    const data = await res.json() as { models?: OllamaModel[] };
    return (data.models ?? []).map((m) => ({ name: m.name, size: m.size }));
  }

  /** Detect native tool-calling support via /api/show capabilities. */
  async supportsTools(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: this.model }),
      });
      if (!res.ok) return false;
      const data = await res.json() as { capabilities?: string[] };
      return Array.isArray(data.capabilities) && data.capabilities.includes("tools");
    } catch {
      return false;
    }
  }
}
