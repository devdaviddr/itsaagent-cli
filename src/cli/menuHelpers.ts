import chalk from "chalk";
import type { AgentDefinition } from "../agent/AgentDefinition.js";
import type { CliConfig } from "./config.js";

export interface MenuState {
  agentId: string;
  model: string;
  providerType: string;
  host: string;
  /** Whether the active model supports native tool use, if known. */
  nativeTools?: boolean;
  /** False when the provider could not be reached. */
  online?: boolean;
}

/** One-line status shown above the home menu. */
export function statusHeader(state: MenuState): string {
  if (state.online === false) {
    return chalk.yellow(`⚠ provider unreachable  ·  ${state.providerType}  ·  ${state.host}`);
  }
  const model = state.nativeTools ? `${state.model} ⚡` : state.model;
  return chalk.dim(`${state.agentId}  ·  ${model}  ·  ${state.providerType}  ·  ${state.host}`);
}

const BACK = "__back" as const;

/** Picker options for agents: built-ins first, custom tagged, plus a Back item. */
export function agentPickerOptions(
  agents: AgentDefinition[],
  isBuiltin: (id: string) => boolean,
): Array<{ value: string; label: string; hint: string }> {
  const sorted = [...agents].sort((a, b) => Number(isBuiltin(b.id)) - Number(isBuiltin(a.id)));
  const opts = sorted.map((a) => {
    const count = a.tools === "all" ? "all tools" : `${a.tools.length} tools`;
    const tag = isBuiltin(a.id) ? "" : " [custom]";
    return { value: a.id, label: `${a.id}${tag}`, hint: `${a.description} · ${count}` };
  });
  return [...opts, { value: BACK, label: "← Back", hint: "" }];
}

export const BACK_VALUE = BACK;

/** Esc/cancel resolves to "quit" only at the top level, otherwise "back". */
export function handleCancel(depth: number): "quit" | "back" {
  return depth === 0 ? "quit" : "back";
}

/** Apply a chosen model onto the config (pure). */
export function applyModelSelection(conf: CliConfig, model: string): CliConfig {
  return { ...conf, model };
}
