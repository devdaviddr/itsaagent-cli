import chalk from "chalk";
import type { Command } from "commander";
import { CONFIG_PATH, loadConfig, saveConfig } from "../config.js";

export function registerConfigCommand(program: Command): void {
  program
    .command("config")
    .description("View or set configuration")
    .option("--set-model <model>", "Set default model")
    .option("--set-host <url>", "Set provider host URL")
    .option("--set-provider <type>", "Set provider type (ollama | openai-compat)")
    .option("--set-max-steps <n>", "Set max agent steps")
    .option("--set-log-dir <dir>", "Set session log directory")
    .action(async (cmdOpts: {
      setModel?: string;
      setHost?: string;
      setProvider?: string;
      setMaxSteps?: string;
      setLogDir?: string;
    }) => {
      const conf = await loadConfig();
      let changed = false;

      if (cmdOpts.setModel) { conf.model = cmdOpts.setModel; changed = true; }
      if (cmdOpts.setHost) { conf.host = cmdOpts.setHost; changed = true; }
      if (cmdOpts.setProvider) {
        if (cmdOpts.setProvider !== "ollama" && cmdOpts.setProvider !== "openai-compat") {
          console.error(chalk.red('Provider must be "ollama" or "openai-compat"'));
          process.exit(1);
        }
        conf.providerType = cmdOpts.setProvider;
        changed = true;
      }
      if (cmdOpts.setMaxSteps) { conf.maxSteps = parseInt(cmdOpts.setMaxSteps, 10); changed = true; }
      if (cmdOpts.setLogDir) { conf.logDir = cmdOpts.setLogDir; changed = true; }

      if (changed) {
        await saveConfig(conf);
        console.error(chalk.green(`Saved to ${CONFIG_PATH}`));
      }

      console.log(JSON.stringify(conf, null, 2));
    });
}
