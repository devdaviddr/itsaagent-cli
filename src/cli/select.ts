import { cancel, intro, isCancel, outro, select, text } from "@clack/prompts";
import type { ModelInfo } from "../providers/Provider.js";

export async function promptForProvider(): Promise<"ollama" | "openai-compat" | null> {
  intro("ItsAAgent");
  const result = await select({
    message: "Select provider:",
    options: [
      { value: "ollama", label: "Ollama (local)", hint: "http://localhost:11434" },
      { value: "openai-compat", label: "OpenAI-compatible endpoint", hint: "LM Studio, vLLM, etc." },
    ],
  });
  if (isCancel(result)) { cancel("Cancelled."); return null; }
  return result as "ollama" | "openai-compat";
}

export async function promptForModel(
  models: ModelInfo[],
  currentModel: string,
): Promise<string | null> {
  if (models.length === 0) {
    const result = await text({
      message: "No models found. Enter model name:",
      defaultValue: currentModel,
    });
    if (isCancel(result)) { cancel("Cancelled."); return null; }
    return result as string;
  }

  const options = models.map((m) => ({
    value: m.name,
    label: m.name,
    hint: m.size ? `${(m.size / 1024 / 1024 / 1024).toFixed(1)} GB` : undefined,
  }));

  const result = await select({ message: "Select model:", options });
  if (isCancel(result)) { cancel("Cancelled."); return null; }
  outro(`Model: ${result as string}`);
  return result as string;
}

export async function promptForTask(): Promise<string | null> {
  const result = await text({ message: "What do you want to do?", placeholder: "describe your task" });
  if (isCancel(result)) { cancel("Cancelled."); return null; }
  return result as string;
}
