import { text, isCancel } from "@clack/prompts";
import chalk from "chalk";
import type { AgentRuntime } from "../agent/AgentRuntime.js";
import { AgentRegistry } from "../agent/AgentRegistry.js";
import { BUILTIN_AGENT_IDS } from "../agent/AgentDefinition.js";
import { loadConfig, saveConfig } from "./config.js";
import { runAgent } from "./output.js";
import { parseChatInput, CHAT_HELP } from "./chatCommands.js";
import { saveSessionTranscript } from "./saveTranscript.js";

/**
 * Interactive chat loop shared by `iaa chat` and the home menu.
 * Handles slash commands (/agent, /agents, /model, /clear, /help, /exit).
 */
export async function runChatSession(runtime: AgentRuntime): Promise<void> {
  const registry = await AgentRegistry.create();
  console.error(chalk.dim(`  ${runtime.agentId} agent · /help for commands · /exit to leave\n`));
  // A resumed session already has history — keep it; otherwise seed the system prompt.
  const resumed = runtime.session.hasHistory;
  if (!resumed) runtime.initSession();
  let first = !resumed;

  while (true) {
    const input = await text({ message: `${runtime.agentId} ›` });
    if (isCancel(input)) break;
    if (!input || typeof input !== "string") continue;

    const cmd = parseChatInput(input);
    switch (cmd.kind) {
      case "exit":
        return;

      case "clear":
        runtime.initSession();
        first = true;
        console.error(chalk.dim("  Context cleared.\n"));
        break;

      case "help":
        console.error(chalk.dim(CHAT_HELP) + "\n");
        break;

      case "agents":
        for (const a of registry.list()) {
          const tag = BUILTIN_AGENT_IDS.has(a.id) ? "" : chalk.magenta(" [custom]");
          console.error(`  ${chalk.cyan(a.id.padEnd(10))} ${a.description}${tag}`);
        }
        console.error("");
        break;

      case "agent": {
        const def = registry.get(cmd.name);
        if (!def) {
          console.error(chalk.red(`Unknown agent "${cmd.name}". Try /agents.`));
          break;
        }
        runtime.setAgent(def);
        runtime.initSession();
        first = true;
        console.error(chalk.green(`  Switched to ${def.id} — context cleared.\n`));
        break;
      }

      case "model": {
        const { ok, models } = await runtime.checkProvider();
        if (!ok) { console.error(chalk.red("Provider unreachable.")); break; }
        const known = models.some((m) => m.name === cmd.name);
        if (!known) {
          console.error(chalk.red(`Unknown model "${cmd.name}". Available: ${models.map((m) => m.name).join(", ")}`));
          break;
        }
        runtime.setModel(cmd.name);
        const conf = await loadConfig();
        await saveConfig({ ...conf, model: cmd.name });
        console.error(chalk.green(`  Model switched to ${cmd.name}.\n`));
        break;
      }

      case "save": {
        try {
          const conf = await loadConfig();
          const path = await saveSessionTranscript(runtime.session, cmd.path, conf.logDir);
          console.error(chalk.green(`  Saved session transcript → ${path}\n`));
        } catch (err) {
          console.error(chalk.red(`  Could not save transcript: ${err instanceof Error ? err.message : String(err)}\n`));
        }
        break;
      }

      case "unknown":
        console.error(chalk.red(`Unknown command "/${cmd.cmd}". Try /help.`));
        break;

      case "message": {
        const answer = await runAgent(runtime, cmd.text, !first);
        first = false;
        console.log(`\n${answer}\n`);
        break;
      }
    }
  }
}
