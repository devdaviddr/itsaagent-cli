import { intro, outro, select, text, isCancel } from "@clack/prompts";
import chalk from "chalk";
import { loadConfig, saveConfig, toAgentConfig, type CliConfig } from "./config.js";
import { AgentRuntime } from "../agent/AgentRuntime.js";
import { AgentRegistry } from "../agent/AgentRegistry.js";
import { BUILTIN_AGENT_IDS } from "../agent/AgentDefinition.js";
import { loadSkills } from "../agent/SkillLoader.js";
import { getDefaultTools } from "../tools/index.js";
import { formatToolDetail } from "./commands/tools.js";
import { runAgent } from "./output.js";

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

async function runTaskFlow(): Promise<void> {
  const task = await text({ message: "Task:", placeholder: "e.g. list the largest files in src/" });
  if (isCancel(task) || !task) return;
  const conf = await loadConfig();
  const agentConfig = await toAgentConfig(conf, {});
  const runtime = new AgentRuntime(agentConfig);
  const { ok } = await runtime.checkProvider();
  if (!ok) { console.error(chalk.red(`Cannot reach ${conf.providerType} at ${conf.host}`)); return; }
  const answer = await runAgent(runtime, String(task));
  console.log(`\n${answer}\n`);
}

async function chatFlow(): Promise<void> {
  const conf = await loadConfig();
  const agentConfig = await toAgentConfig(conf, {});
  const runtime = new AgentRuntime(agentConfig);
  const { ok } = await runtime.checkProvider();
  if (!ok) { console.error(chalk.red(`Cannot reach ${conf.providerType} at ${conf.host}`)); return; }
  console.error(chalk.dim("  /exit to return to the menu\n"));
  runtime.initSession();
  let first = true;
  while (true) {
    const input = await text({ message: ">" });
    if (isCancel(input) || input === "/exit") break;
    if (!input || typeof input !== "string") continue;
    const answer = await runAgent(runtime, input, !first);
    first = false;
    console.log(`\n${answer}\n`);
  }
}

async function showAgents(): Promise<void> {
  const registry = await AgentRegistry.create();
  console.log(chalk.bold("\nAgents:"));
  for (const a of registry.list()) {
    const tag = BUILTIN_AGENT_IDS.has(a.id) ? "" : chalk.magenta(" [custom]");
    console.log(`  ${chalk.cyan(a.id.padEnd(10))} ${a.description}${tag}`);
  }
  console.log();
}

async function browseTools(): Promise<void> {
  const tools = getDefaultTools();
  while (true) {
    const choice = await select({
      message: "Tools",
      options: [
        ...tools.map((t) => ({ value: t.definition.name, label: t.definition.name, hint: t.definition.description })),
        { value: "__back", label: "← Back" },
      ],
    });
    if (isCancel(choice) || choice === "__back") return;
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

  const updated = applyProviderSettings(conf, {
    providerType: String(providerType),
    host: String(host),
    model: String(model),
    apiKey: String(apiKey),
  });
  await saveConfig(updated);
  console.log(chalk.green("\nSettings saved.\n"));
}

export async function showHomeMenu(): Promise<void> {
  const conf = await loadConfig();
  intro(chalk.bold("ItsAAgent"));
  console.error(chalk.dim(`  ${conf.model}  ·  ${conf.providerType}  ·  ${conf.host}\n`));

  while (true) {
    const choice = await select({
      message: "What would you like to do?",
      options: [
        { value: "run", label: "Run a task" },
        { value: "chat", label: "Chat" },
        { value: "agents", label: "Agents" },
        { value: "tools", label: "Tools" },
        { value: "skills", label: "Skills" },
        { value: "settings", label: "Provider settings" },
        { value: "quit", label: "Quit" },
      ],
    });

    if (isCancel(choice) || choice === "quit") {
      outro("Goodbye.");
      return;
    }

    switch (choice) {
      case "run": await runTaskFlow(); break;
      case "chat": await chatFlow(); break;
      case "agents": await showAgents(); break;
      case "tools": await browseTools(); break;
      case "skills": await showSkills(); break;
      case "settings": await settingsFlow(); break;
    }
  }
}
