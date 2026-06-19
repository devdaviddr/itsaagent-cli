import { ProviderError } from "../agent/errors.js";
import type { ProviderConfig, StreamChunk } from "../types.js";
import type { ChatMessage, ModelInfo, Provider } from "./Provider.js";

interface SSEDelta {
  choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
}

export class OpenAICompatProvider implements Provider {
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly temperature: number;
  private readonly maxTokens: number;
  private readonly apiKey: string;

  constructor(config: ProviderConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.model = config.model;
    this.temperature = config.temperature;
    this.maxTokens = config.maxTokens;
    this.apiKey = config.apiKey ?? process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
  }

  async *stream(messages: ChatMessage[]): AsyncGenerator<StreamChunk> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: true,
          temperature: this.temperature,
          max_tokens: this.maxTokens,
        }),
      });
    } catch (err: unknown) {
      throw new ProviderError(`Cannot reach endpoint at ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!response.ok || !response.body) {
      throw new ProviderError(`API error (${response.status}): ${await response.text()}`, response.status);
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
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") { yield { delta: "", done: true }; continue; }
          try {
            const chunk = JSON.parse(data) as SSEDelta;
            const delta = chunk.choices?.[0]?.delta?.content ?? "";
            const isDone = chunk.choices?.[0]?.finish_reason != null;
            yield { delta, done: isDone };
          } catch { /* skip malformed SSE */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/models`, {
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(`${this.baseUrl}/v1/models`, {
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
    });
    if (!res.ok) throw new ProviderError(`Failed to list models: ${res.status}`, res.status);
    const data = await res.json() as { data?: Array<{ id: string }> };
    return (data.data ?? []).map((m) => ({ name: m.id }));
  }
}
