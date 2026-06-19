import chalk from "chalk";
import type { Command } from "commander";
import { AgentRuntime } from "../../agent/AgentRuntime.js";
import { loadConfig, toAgentConfig } from "../config.js";
import { promptForModel } from "../select.js";

export function registerModelsCommand(program: Command): void {
  program
    .command("models")
    .description("List available models. Pass --select to save one as default.")
    .option("--select", "Interactively select and save a model as default")
    .action(async (cmdOpts: { select?: boolean }) => {
      const conf = await loadConfig();
      const opts = program.optsWithGlobals<{ model?: string; host?: string }>();
      const runtime = new AgentRuntime(await toAgentConfig(conf, opts));

      const { ok, models } = await runtime.checkProvider();
      if (!ok) { console.error(chalk.red("Cannot reach provider")); process.exit(1); }

      if (models.length === 0) {
        console.log("No models found.");
        return;
      }

      if (cmdOpts.select) {
        const { loadConfig: lc, saveConfig } = await import("../config.js");
        const current = await lc();
        const chosen = await promptForModel(models, current.model);
        if (chosen) {
          current.model = chosen;
          await saveConfig(current);
          console.log(chalk.green(`Default model set to ${chosen}`));
        }
        return;
      }

      console.log(chalk.bold("\nAvailable models:"));
      for (const m of models) {
        const size = m.size ? (m.size / 1024 / 1024 / 1024).toFixed(2) + " GB" : "";
        console.log(`  ${chalk.cyan(m.name.padEnd(35))} ${chalk.dim(size)}`);
      }
      console.log();
    });
}
