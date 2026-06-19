import { ProviderError } from "../agent/errors.js";
import type { ProviderConfig, StreamChunk } from "../types.js";
import type { ChatMessage, ModelInfo, Provider } from "./Provider.js";

interface OllamaStreamChunk {
  message?: { content?: string };
  done: boolean;
}

interface OllamaModel {
  name: string;
  size: number;
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

  async *stream(messages: ChatMessage[]): AsyncGenerator<StreamChunk> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: true,
          options: { temperature: this.temperature, num_predict: this.maxTokens },
        }),
      });
    } catch (err: unknown) {
      throw new ProviderError(`Cannot reach Ollama at ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!response.ok || !response.body) {
      throw new ProviderError(`Ollama error (${response.status}): ${await response.text()}`, response.status);
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
}
