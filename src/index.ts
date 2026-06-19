#!/usr/bin/env node

import { Command } from "commander";
import { registerAgentsCommand } from "./cli/commands/agents.js";
import { registerCheckCommand } from "./cli/commands/check.js";
import { registerChatCommand } from "./cli/commands/chat.js";
import { registerConfigCommand } from "./cli/commands/config.js";
import { registerModelsCommand } from "./cli/commands/models.js";
import { registerRunCommand } from "./cli/commands/run.js";
import { registerSkillsCommand } from "./cli/commands/skills.js";
import { shouldShowMenu, showHomeMenu } from "./cli/menu.js";

const program = new Command();

const collect = (val: string, acc: string[]): string[] => { acc.push(val); return acc; };

program
  .name("iaa")
  .description("ItsAAgent — Ollama-optimised ReAct agent for the CLI")
  .version("0.2.0")
  .option("-v, --verbose", "Show agent reasoning, tool calls, and stream output live")
  .option("-l, --log", "Write session log to disk (auto-enabled with -v)")
  .option("-m, --model <model>", "Override the model for this run")
  .option("--host <url>", "Override provider host URL")
  .option("-s, --max-steps <n>", "Override max ReAct iterations", parseInt)
  .option("-a, --agent <id>", "Select an agent (build, plan, cli)")
  .option("--skill <name>", "Apply a skill (repeatable)", collect, [])
  .option("--skill-arg <name=value>", "Provide a skill arg value (repeatable)", collect, []);

registerRunCommand(program);
registerChatCommand(program);
registerAgentsCommand(program);
registerSkillsCommand(program);
registerModelsCommand(program);
registerCheckCommand(program);
registerConfigCommand(program);

if (shouldShowMenu(process.argv, Boolean(process.stdout.isTTY))) {
  showHomeMenu().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
} else {
  program.parse(process.argv);
}
