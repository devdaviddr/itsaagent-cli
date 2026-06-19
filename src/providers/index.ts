import type { ProviderConfig } from "../types.js";
import { OllamaProvider } from "./OllamaProvider.js";
import { OpenAICompatProvider } from "./OpenAICompatProvider.js";
import type { Provider } from "./Provider.js";

export function createProvider(config: ProviderConfig): Provider {
  switch (config.type) {
    case "ollama":
      return new OllamaProvider(config);
    case "openai-compat":
      return new OpenAICompatProvider(config);
    default: {
      const exhaustive: never = config.type;
      throw new Error(`Unknown provider type: ${String(exhaustive)}`);
    }
  }
}

export type { Provider } from "./Provider.js";
export { OllamaProvider } from "./OllamaProvider.js";
export { OpenAICompatProvider } from "./OpenAICompatProvider.js";
