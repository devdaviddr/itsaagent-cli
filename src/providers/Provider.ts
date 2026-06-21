import type { StreamChunk, ToolSpec } from "../types.js";

export interface ChatMessage {
  role: string;
  content: string;
}

export interface ModelInfo {
  name: string;
  size?: number;
}

export interface Provider {
  /** Stream a completion. When `tools` is provided and the model supports native
   *  function calling, the final chunk carries `toolCalls`. */
  stream(messages: ChatMessage[], tools?: ToolSpec[]): AsyncGenerator<StreamChunk>;
  checkHealth(): Promise<boolean>;
  listModels(): Promise<ModelInfo[]>;
  /** True if the active model supports native tool calling. Optional — absent = no support. */
  supportsTools?(): Promise<boolean>;
  /** Embed one or more texts into vectors. Optional — absent = no embedding support. */
  embed?(texts: string[], model: string): Promise<number[][]>;
}
