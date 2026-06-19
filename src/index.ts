#!/usr/bin/env node

import { Command } from "commander";
import { registerCheckCommand } from "./cli/commands/check.js";
import { registerChatCommand } from "./cli/commands/chat.js";
import { registerConfigCommand } from "./cli/commands/config.js";
import { registerModelsCommand } from "./cli/commands/models.js";
import { registerRunCommand } from "./cli/commands/run.js";

const program = new Command();

program
  .name("iaa")
  .description("ItsAAgent — Ollama-optimised ReAct agent for the CLI")
  .version("0.2.0")
  .option("-v, --verbose", "Show agent reasoning, tool calls, and stream output live")
  .option("-l, --log", "Write session log to disk (auto-enabled with -v)")
  .option("-m, --model <model>", "Override the model for this run")
  .option("--host <url>", "Override provider host URL")
  .option("-s, --max-steps <n>", "Override max ReAct iterations", parseInt);

registerRunCommand(program);
registerChatCommand(program);
registerModelsCommand(program);
registerCheckCommand(program);
registerConfigCommand(program);

program.parse(process.argv);
