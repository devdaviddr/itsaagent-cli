import { intro, outro, select, text, isCancel } from "@clack/prompts";
import chalk from "chalk";
import { loadConfig, saveConfig, toAgentConfig, type CliConfig } from "./config.js";
import { AgentRuntime } from "../agent/AgentRuntime.js";
import { AgentRegistry } from "../agent/AgentRegistry.js";
import { DEFAULT_AGENT_ID } from "../agent/AgentDefinition.js";
import { loadSkills } from "../agent/SkillLoader.js";
import { getDefaultTools } from "../tools/index.js";
import { formatToolDetail } from "./commands/tools.js";
import { runAgent } from "./output.js";
import {
  statusHeader,
  agentPickerOptions,
  handleCancel,
  applyModelSelection,
  BACK_VALUE,
  type MenuState,
} from "./menuHelpers.js";

/** The home menu is shown only when invoked with no args in an interactive terminal. */
export function shouldShowMenu(argv: string[], isTTY: boolean): boolean {
  return argv.length === 2 && isTTY;
}

/** Apply provider-settings answers onto a config (pure, for testability). */
export function applyProviderSettings(
  conf: CliConfig,
  answers: { providerType?: string; host?: string; model?: string; apiKey?: string },
): CliConfig {
  return {
    ...conf,
    providerType: (answers.providerType as CliConfig["providerType"]) ?? conf.providerType,
    host: answers.host ?? conf.host,
    model: answers.model ?? conf.model,
    apiKey: answers.apiKey !== undefined && answers.apiKey !== "" ? answers.apiKey : conf.apiKey,
  };
}

async function runTaskFlow(agentId: string): Promise<void> {
  const task = await text({ message: "Task:", placeholder: "e.g. list the largest files in src/" });
  if (isCancel(task) || !task) return;
  const conf = await loadConfig();
  const runtime = new AgentRuntime(await toAgentConfig(conf, { agent: agentId }));
  const { ok } = await runtime.checkProvider();
  if (!ok) { console.error(chalk.red(`Cannot reach ${conf.providerType} at ${conf.host}`)); return; }
  const answer = await runAgent(runtime, String(task));
  console.log(`\n${answer}\n`);
}

async function chatFlow(agentId: string): Promise<void> {
  const conf = await loadConfig();
  const runtime = new AgentRuntime(await toAgentConfig(conf, { agent: agentId }));
  const { ok } = await runtime.checkProvider();
  if (!ok) { console.error(chalk.red(`Cannot reach ${conf.providerType} at ${conf.host}`)); return; }
  console.error(chalk.dim(`  ${agentId} agent · /exit to return to the menu\n`));
  runtime.initSession();
  let first = true;
  while (true) {
    const input = await text({ message: `${agentId} ›` });
    if (isCancel(input) || input === "/exit") break;
    if (!input || typeof input !== "string") continue;
    const answer = await runAgent(runtime, input, !first);
    first = false;
    console.log(`\n${answer}\n`);
  }
}

/** Agent picker. Returns the chosen id, or undefined on Back/cancel. */
async function pickAgent(currentId: string): Promise<string | undefined> {
  const registry = await AgentRegistry.create();
  const choice = await select({
    message: "Select agent",
    options: agentPickerOptions(registry.list(), (id) => registry.isBuiltin(id)),
    initialValue: currentId,
  });
  if (isCancel(choice) || choice === BACK_VALUE) return undefined;
  return String(choice);
}

/** Model picker from live provider models. Persists selection. Returns chosen model or undefined. */
async function pickModel(): Promise<string | undefined> {
  const conf = await loadConfig();
  const runtime = new AgentRuntime(await toAgentConfig(conf, {}));
  const { ok, models } = await runtime.checkProvider();
  if (!ok) { console.error(chalk.red(`Cannot reach ${conf.providerType} at ${conf.host}`)); return undefined; }
  if (models.length === 0) { console.error(chalk.yellow("No models available.")); return undefined; }

  const choice = await select({
    message: "Select model",
    options: [
      ...models.map((m) => ({
        value: m.name,
        label: m.name,
        hint: m.size ? `${(m.size / 1024 / 1024 / 1024).toFixed(1)} GB` : undefined,
      })),
      { value: BACK_VALUE, label: "← Back" },
    ],
    initialValue: conf.model,
  });
  if (isCancel(choice) || choice === BACK_VALUE) return undefined;
  await saveConfig(applyModelSelection(conf, String(choice)));
  return String(choice);
}

async function browseTools(): Promise<void> {
  const tools = getDefaultTools();
  while (true) {
    const choice = await select({
      message: "Tools",
      options: [
        ...tools.map((t) => ({ value: t.definition.name, label: t.definition.name, hint: t.definition.description })),
        { value: BACK_VALUE, label: "← Back" },
      ],
    });
    if (isCancel(choice) || choice === BACK_VALUE) return;
    const tool = tools.find((t) => t.definition.name === choice);
    if (tool) console.log(formatToolDetail(tool));
  }
}

async function showSkills(): Promise<void> {
  const skills = await loadSkills();
  if (skills.length === 0) { console.log(chalk.dim("\nNo skills installed.\n")); return; }
  console.log(chalk.bold("\nSkills:"));
  for (const s of skills) console.log(`  ${chalk.cyan(s.name.padEnd(16))} ${s.description}`);
  console.log();
}

async function settingsFlow(): Promise<void> {
  const conf = await loadConfig();
  const providerType = await select({
    message: "Provider type",
    options: [
      { value: "ollama", label: "ollama" },
      { value: "openai-compat", label: "openai-compat" },
    ],
    initialValue: conf.providerType,
  });
  if (isCancel(providerType)) return;
  const host = await text({ message: "Host / URL", initialValue: conf.host });
  if (isCancel(host)) return;
  const model = await text({ message: "Model", initialValue: conf.model });
  if (isCancel(model)) return;
  const apiKey = await text({ message: "API key (blank to keep current)", initialValue: "" });
  if (isCancel(apiKey)) return;

  await saveConfig(applyProviderSettings(conf, {
    providerType: String(providerType),
    host: String(host),
    model: String(model),
    apiKey: String(apiKey),
  }));
  console.log(chalk.green("\nSettings saved.\n"));
}

/** Best-effort: detect provider reachability and the active model's tool-use support. */
async function refreshProviderState(state: MenuState): Promise<void> {
  try {
    const conf = await loadConfig();
    const runtime = new AgentRuntime(await toAgentConfig(conf, { agent: state.agentId }));
    const { ok } = await runtime.checkProvider();
    state.online = ok;
    state.nativeTools = ok ? await runtime.detectToolUse() : undefined;
  } catch {
    state.online = false;
  }
}

export async function showHomeMenu(): Promise<void> {
  const conf = await loadConfig();
  const state: MenuState = {
    agentId: DEFAULT_AGENT_ID,
    model: conf.model,
    providerType: conf.providerType,
    host: conf.host,
  };
  intro(chalk.bold("ItsAAgent"));
  await refreshProviderState(state);

  while (true) {
    console.error(statusHeader(state));
    const choice = await select({
      message: "What would you like to do?",
      options: [
        { value: "run", label: "Run a task" },
        { value: "chat", label: "Chat" },
        { value: "agent", label: `Agent: ${state.agentId}` },
        { value: "model", label: `Model: ${state.model}` },
        { value: "tools", label: "Tools" },
        { value: "skills", label: "Skills" },
        { value: "settings", label: "Provider settings" },
        { value: "quit", label: "Quit" },
      ],
    });

    if ((isCancel(choice) && handleCancel(0) === "quit") || choice === "quit") {
      outro("Goodbye.");
      return;
    }

    switch (choice) {
      case "run": await runTaskFlow(state.agentId); break;
      case "chat": await chatFlow(state.agentId); break;
      case "agent": {
        const picked = await pickAgent(state.agentId);
        if (picked) state.agentId = picked;
        break;
      }
      case "model": {
        const picked = await pickModel();
        if (picked) { state.model = picked; await refreshProviderState(state); }
        break;
      }
      case "tools": await browseTools(); break;
      case "skills": await showSkills(); break;
      case "settings": {
        await settingsFlow();
        const updated = await loadConfig();
        state.model = updated.model;
        state.providerType = updated.providerType;
        state.host = updated.host;
        await refreshProviderState(state);
        break;
      }
    }
  }
}
