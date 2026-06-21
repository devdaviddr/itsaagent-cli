import { resolve } from "node:path";
import chalk from "chalk";
import type { Command } from "commander";
import { createProvider } from "../../providers/index.js";
import { buildIndex, saveIndex } from "../../agent/codeIndex.js";
import { loadConfig, toAgentConfig } from "../config.js";

export function registerIndexCommand(program: Command): void {
  program
    .command("index [path]")
    .description("Build a local semantic code index for `search_code` (uses the embed model).")
    .action(async (pathArg: string | undefined) => {
      const conf = await loadConfig();
      const opts = program.optsWithGlobals<{ model?: string; host?: string }>();
      const agentConfig = await toAgentConfig(conf, opts);
      const provider = createProvider(agentConfig.provider);
      const embedModel = conf.embedModel ?? "nomic-embed-text";
      const root = resolve(pathArg ?? process.cwd());

      if (!provider.embed) {
        console.error(chalk.red("This provider does not support embeddings — cannot build a code index."));
        process.exit(1);
      }
      const embed = provider.embed.bind(provider);

      console.error(chalk.bold("ItsAAgent — Build code index\n"));
      console.error(chalk.dim(`Root:        ${root}`));
      console.error(chalk.dim(`Embed model: ${embedModel}\n`));

      let lastLine = 0;
      try {
        const index = await buildIndex(root, (t, m) => embed(t, m), embedModel, {
          onProgress: (done, total) => {
            // Throttle redraws to avoid spamming the terminal.
            if (done === total || done - lastLine >= 64) {
              lastLine = done;
              process.stderr.write(`\r${chalk.dim(`Indexed ${done}/${total} chunks`)}`);
            }
          },
        });
        process.stderr.write("\n");

        if (index.entries.length === 0) {
          console.error(chalk.yellow("No code chunks were indexed (no source files found, or embedding returned nothing)."));
          process.exit(1);
        }

        const indexPath = await saveIndex(index);
        console.error(chalk.green(`\n✓ Indexed ${index.entries.length} chunk(s)`));
        console.error(chalk.dim(`  Saved to: ${indexPath}`));
        console.error(chalk.dim(`  Now use the search_code tool, or \`iaa run\`, in this directory.\n`));
      } catch (err: unknown) {
        process.stderr.write("\n");
        console.error(chalk.red(`Failed to build index: ${err instanceof Error ? err.message : String(err)}`));
        console.error(chalk.yellow(`Is the embed model pulled? Run: ollama pull ${embedModel}`));
        process.exit(1);
      }
    });
}
