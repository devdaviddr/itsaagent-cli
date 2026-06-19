import chalk from "chalk";
import type { Command } from "commander";
import { AgentRuntime } from "../../agent/AgentRuntime.js";
import { loadConfig, toAgentConfig, CONFIG_PATH } from "../config.js";

export function registerCheckCommand(program: Command): void {
  program
    .command("check")
    .description("Check provider connection and model availability")
    .action(async () => {
      const conf = await loadConfig();
      const opts = program.optsWithGlobals<{ model?: string; host?: string }>();
      const agentConfig = toAgentConfig(conf, opts);
      const runtime = new AgentRuntime(agentConfig);

      console.error(chalk.bold("ItsAAgent — Health Check\n"));
      console.error(chalk.dim(`Config:   ${CONFIG_PATH}`));
      console.error(chalk.dim(`Provider: ${conf.providerType}`));
      console.error(chalk.dim(`Host:     ${agentConfig.provider.baseUrl}`));
      console.error(chalk.dim(`Model:    ${agentConfig.provider.model}`));

      const { ok, models } = await runtime.checkProvider();
      if (!ok) {
        console.error(chalk.red(`\n✗ Cannot reach provider at ${agentConfig.provider.baseUrl}`));
        if (conf.providerType === "ollama") console.error(chalk.yellow("  Start with: ollama serve"));
        process.exit(1);
      }

      const normalize = (n: string) => (n.endsWith(":latest") ? n.slice(0, -7) : n);
      const target = normalize(agentConfig.provider.model);
      const hasModel = models.some((m) => m.name === agentConfig.provider.model || normalize(m.name) === target);
      if (!hasModel) {
        console.error(chalk.yellow(`\n✗ Model "${agentConfig.provider.model}" not found.`));
        console.error(chalk.dim(`  Available: ${models.map((m) => m.name).join(", ") || "none"}`));
        process.exit(1);
      }

      console.error(chalk.green(`\n✓ Provider online (${models.length} model${models.length === 1 ? "" : "s"})`));
      console.error(chalk.green(`✓ Model "${agentConfig.provider.model}" ready`));

      const nativeTools = await runtime.detectToolUse();
      if (nativeTools) {
        console.error(chalk.green(`✓ Native tool use supported\n`));
      } else {
        console.error(chalk.yellow(`✗ Native tool use not supported — using text-parser fallback\n`));
      }
    });
}
