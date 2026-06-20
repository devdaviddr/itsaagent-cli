import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentConfig, ProviderConfig } from "../types.js";
import { AgentRegistry } from "../agent/AgentRegistry.js";
import { DEFAULT_AGENT_ID } from "../agent/AgentDefinition.js";
import { resolveModelProfile } from "../providers/modelProfiles.js";

export const CONFIG_DIR = join(homedir(), ".config", "ai-cli");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");
/** Where persisted chat sessions live (for `iaa chat --resume` / `iaa sessions`). */
export const SESSIONS_DIR = join(CONFIG_DIR, "sessions");

export interface CliConfig {
  providerType: "ollama" | "openai-compat";
  model: string;
  host: string;
  apiKey?: string;
  maxSteps: number;
  maxContextTokens: number;
  logDir: string;
  /** TUI theme name (see src/cli/tui/theme.ts). Optional; unknown/unset → default. */
  theme?: string;
  /**
   * User-defined theme overrides, selected via `theme: "custom"`. Any subset of
   * theme fields: colours (user/assistant/accent/error/…), `background`, `panel`,
   * and `bold`. Example: { "theme": "custom", "customTheme": { "accent": "#ff8800", "background": "#101010", "bold": false } }
   */
  customTheme?: import("./tui/theme.js").ThemeOverrides;
  /**
   * Enable mouse/trackpad wheel scrolling in the TUI. Off by default because
   * capturing the mouse disables native terminal text selection/copy. Keyboard
   * scroll (↑/↓, Ctrl+U/D) works regardless.
   */
  mouse?: boolean;
  /**
   * Include a worked few-shot exemplar in the system prompt (default true).
   * Set false to A/B test prompt size vs. reliability with the e2e harness.
   */
  fewShot?: boolean;
  /** Auto-load the nearest AGENTS.md into the system prompt (default true). */
  projectContext?: boolean;
  /** Inject git state (branch, changes, recent commits) into the prompt (default true). */
  gitContext?: boolean;
  /**
   * Context compaction as the window fills: "structured" (default, deterministic
   * — shrink old tool results, drop superseded reads), "summarize" (also folds
   * older turns via a local-model call), or "off" (evict only at 100%).
   */
  compaction?: "off" | "structured" | "summarize";
  /** Window fraction (0–1) at which compaction kicks in (default 0.8). */
  compactionThreshold?: number;
  /** Override sampling temperature (default: per-model profile, ~0.15). */
  temperature?: number;
  /** Override max tokens generated per turn (default: per-model profile, 8192). */
  numPredict?: number;
  /** Extra stop sequences passed to the model. */
  stop?: string[];
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

  // Agent model override takes precedence over config, but an explicit --model flag wins.
  const model = opts.model ?? agent.model ?? conf.model;
  // Per-model profile supplies defaults; explicit config values override them.
  const profile = resolveModelProfile(model);

  const numPredict = conf.numPredict ?? profile.numPredict;
  const providerConfig: ProviderConfig = {
    type: conf.providerType,
    baseUrl: opts.host ?? conf.host,
    model,
    temperature: conf.temperature ?? profile.temperature,
    maxTokens: numPredict,
    // num_ctx is the TOTAL window (prompt + generation). maxContextTokens is the
    // input budget we trim to, so the full window must also leave room for the
    // response — otherwise Ollama truncates the prompt we worked to preserve.
    numCtx: conf.maxContextTokens + numPredict,
    stop: conf.stop ?? profile.stop,
  };

  return {
    provider: providerConfig,
    verbose: opts.verbose ?? false,
    maxSteps: opts.maxSteps ?? conf.maxSteps,
    maxContextTokens: conf.maxContextTokens,
    logDir: opts.log || opts.verbose ? conf.logDir : undefined,
    agent,
    fewShot: conf.fewShot,
    projectContext: conf.projectContext,
    gitContext: conf.gitContext,
    compaction: conf.compaction ?? "structured",
    compactionThreshold: conf.compactionThreshold ?? 0.8,
  };
}
