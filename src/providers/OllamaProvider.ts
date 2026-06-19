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

  constructor(config: ProviderConfig) {
    this.baseUrl = config.baseUrl;
    this.model = config.model;
    this.temperature = config.temperature;
    this.maxTokens = config.maxTokens;
  }

  async *stream(messages: ChatMessage[], tools?: ToolSpec[]): AsyncGenerator<StreamChunk> {
    const useTools = Array.isArray(tools) && tools.length > 0;
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages,
          // Tool calls are collected from a single non-streamed response for reliable extraction.
          stream: !useTools,
          options: { temperature: this.temperature, num_predict: this.maxTokens },
          ...(useTools ? { tools } : {}),
        }),
      });
    } catch (err: unknown) {
      throw new ProviderError(`Cannot reach Ollama at ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!response.ok || !response.body) {
      throw new ProviderError(`Ollama error (${response.status}): ${await response.text()}`, response.status);
    }

    // Native tool-use path: one JSON object with content + optional tool_calls.
    if (useTools) {
      const data = await response.json() as OllamaStreamChunk;
      const content = data.message?.content ?? "";
      const calls = normaliseToolCalls(data.message?.tool_calls);
      if (content) yield { delta: content, done: false };
      yield { delta: "", done: true, toolCalls: calls.length > 0 ? calls : undefined };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

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
            yield { delta: chunk.message?.content ?? "", done: chunk.done };
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
