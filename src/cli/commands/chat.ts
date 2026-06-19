import { intro, isCancel, outro, text } from "@clack/prompts";
import chalk from "chalk";
import type { Command } from "commander";
import { AgentRuntime } from "../../agent/AgentRuntime.js";
import { loadConfig, toAgentConfig } from "../config.js";
import { runAgent } from "../output.js";

export function registerChatCommand(program: Command): void {
  program
    .command("chat")
    .description("Interactive chat mode")
    .action(async () => {
      const conf = await loadConfig();
      const opts = program.optsWithGlobals<{ verbose?: boolean; log?: boolean; model?: string; host?: string; maxSteps?: number; agent?: string }>();
      let agentConfig;
      try {
        agentConfig = toAgentConfig(conf, opts);
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }
      const runtime = new AgentRuntime(agentConfig);

      const { ok } = await runtime.checkProvider();
      if (!ok) {
        console.error(chalk.red(`Cannot reach ${conf.providerType} at ${conf.host}`));
        process.exit(1);
      }

      intro(`ItsAAgent · ${agentConfig.provider.model}`);
      console.error(chalk.dim("  /exit to quit  /clear to reset context\n"));

      runtime.initSession();
      let isFirst = true;

      while (true) {
        const input = await text({ message: ">" });

        if (isCancel(input) || input === "/exit" || input === "/quit") {
          outro("Goodbye.");
          break;
        }

        if (input === "/clear") {
          runtime.initSession();
          isFirst = true;
          console.error(chalk.dim("  Context cleared.\n"));
          continue;
        }

        if (!input || typeof input !== "string") continue;

        let answer: string;
        if (isFirst) {
          answer = await runAgent(runtime, input);
          isFirst = false;
        } else {
          answer = await runAgent(runtime, input, true);
        }
        console.log(`\n${answer}\n`);
      }
    });
}
