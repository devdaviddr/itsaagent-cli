import chalk from "chalk";
import type { Command } from "commander";
import { AgentRuntime } from "../../agent/AgentRuntime.js";
import { loadConfig, toAgentConfig, CONFIG_PATH } from "../config.js";
import { runAgent } from "../output.js";

export function registerRunCommand(program: Command): void {
  program
    .command("run <task>")
    .description("Execute a task")
    .action(async (task: string) => {
      const conf = await loadConfig();
      const opts = program.optsWithGlobals<{ verbose?: boolean; log?: boolean; model?: string; host?: string; maxSteps?: number }>();

      if (opts.verbose) console.error(chalk.dim(`Config: ${CONFIG_PATH}`));

      const agentConfig = toAgentConfig(conf, opts);
      const runtime = new AgentRuntime(agentConfig);

      const { ok, models } = await runtime.checkProvider();
      if (!ok) {
        console.error(chalk.red(`Cannot reach ${conf.providerType} at ${conf.host}`));
        process.exit(1);
      }

      const normalize = (n: string) => (n.endsWith(":latest") ? n.slice(0, -7) : n);
      const target = normalize(agentConfig.provider.model);
      const hasModel = models.some((m) => m.name === agentConfig.provider.model || normalize(m.name) === target);
      if (!hasModel) {
        console.error(chalk.yellow(
          `Model "${agentConfig.provider.model}" not found. Available: ${models.map((m) => m.name).join(", ") || "none"}`,
        ));
        process.exit(1);
      }

      const answer = await runAgent(runtime, task);
      console.log(answer);
    });
}
