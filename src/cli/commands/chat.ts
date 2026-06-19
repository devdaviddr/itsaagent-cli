import { intro, outro } from "@clack/prompts";
import chalk from "chalk";
import type { Command } from "commander";
import { AgentRuntime } from "../../agent/AgentRuntime.js";
import { loadConfig, toAgentConfig } from "../config.js";
import { resolveCliSkills } from "../skillResolve.js";
import { runChatSession } from "../chatSession.js";

export function registerChatCommand(program: Command): void {
  program
    .command("chat")
    .description("Interactive chat mode (slash commands: /agent, /agents, /model, /clear, /help, /exit)")
    .action(async () => {
      const conf = await loadConfig();
      const opts = program.optsWithGlobals<{
        verbose?: boolean; log?: boolean; model?: string; host?: string;
        maxSteps?: number; agent?: string; skill?: string[]; skillArg?: string[];
      }>();
      let agentConfig;
      try {
        agentConfig = await toAgentConfig(conf, opts);
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }

      const { skills, error } = await resolveCliSkills(opts.skill ?? [], opts.skillArg ?? []);
      if (error) {
        console.error(chalk.red(error));
        process.exit(1);
      }
      agentConfig.skills = skills;

      const runtime = new AgentRuntime(agentConfig);
      const { ok } = await runtime.checkProvider();
      if (!ok) {
        console.error(chalk.red(`Cannot reach ${conf.providerType} at ${conf.host}`));
        process.exit(1);
      }

      intro(`ItsAAgent · ${agentConfig.provider.model}`);
      await runChatSession(runtime);
      outro("Goodbye.");
    });
}
