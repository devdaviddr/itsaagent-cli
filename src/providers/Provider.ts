import type { StreamChunk } from "../types.js";

export interface ChatMessage {
  role: string;
  content: string;
}

export interface ModelInfo {
  name: string;
  size?: number;
}

export interface Provider {
  stream(messages: ChatMessage[]): AsyncGenerator<StreamChunk>;
  checkHealth(): Promise<boolean>;
  listModels(): Promise<ModelInfo[]>;
}
