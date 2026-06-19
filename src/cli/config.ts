import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentConfig, ProviderConfig } from "../types.js";
import { AgentRegistry } from "../agent/AgentRegistry.js";
import { DEFAULT_AGENT_ID } from "../agent/AgentDefinition.js";

export const CONFIG_DIR = join(homedir(), ".config", "ai-cli");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export interface CliConfig {
  providerType: "ollama" | "openai-compat";
  model: string;
  host: string;
  apiKey?: string;
  maxSteps: number;
  maxContextTokens: number;
  logDir: string;
}

export function defaultConfig(): CliConfig {
  return {
    providerType: "ollama",
    model: "qwen2.5-coder-7b-32k:latest",
    host: "http://localhost:11434",
    maxSteps: 25,
    maxContextTokens: 24576,
    logDir: join(homedir(), ".config", "ai-cli", "logs"),
  };
}

export async function loadConfig(): Promise<CliConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<CliConfig>;
    return { ...defaultConfig(), ...parsed };
  } catch {
    return defaultConfig();
  }
}

export async function saveConfig(config: CliConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

export async function toAgentConfig(
  conf: CliConfig,
  opts: { verbose?: boolean; log?: boolean; model?: string; host?: string; maxSteps?: number; agent?: string },
): Promise<AgentConfig> {
  const registry = await AgentRegistry.create();
  const agentId = opts.agent ?? DEFAULT_AGENT_ID;
  const agent = registry.get(agentId);
  if (!agent) {
    const available = registry.list().map((a) => a.id).join(", ");
    throw new Error(`Unknown agent "${agentId}". Available: ${available}`);
  }

  const providerConfig: ProviderConfig = {
    type: conf.providerType,
    baseUrl: opts.host ?? conf.host,
    // Agent model override takes precedence over config, but an explicit --model flag wins.
    model: opts.model ?? agent.model ?? conf.model,
    temperature: 0.15,
    maxTokens: 8192,
  };

  return {
    provider: providerConfig,
    verbose: opts.verbose ?? false,
    maxSteps: opts.maxSteps ?? conf.maxSteps,
    maxContextTokens: conf.maxContextTokens,
    logDir: opts.log || opts.verbose ? conf.logDir : undefined,
    agent,
  };
}
