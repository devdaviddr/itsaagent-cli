import chalk from "chalk";
import type { Command } from "commander";
import { AgentRuntime } from "../../agent/AgentRuntime.js";
import { loadConfig, toAgentConfig, CONFIG_PATH } from "../config.js";
import { runAgent } from "../output.js";
import { resolveCliSkills } from "../skillResolve.js";
import { loadSkills } from "../../agent/SkillLoader.js";

export function registerRunCommand(program: Command): void {
  program
    .command("run <task...>")
    .description("Execute a task. Prefix with /skill-name to run a skill (e.g. run /refactor src/x.ts).")
    .action(async (taskParts: string[]) => {
      const conf = await loadConfig();
      const opts = program.optsWithGlobals<{
        verbose?: boolean; log?: boolean; model?: string; host?: string;
        maxSteps?: number; agent?: string; skill?: string[]; skillArg?: string[];
      }>();

      if (opts.verbose) console.error(chalk.dim(`Config: ${CONFIG_PATH}`));

      // /name shorthand: leading token like "/refactor" selects a skill and maps
      // the remaining words positionally onto that skill's args.
      const skillNames = [...(opts.skill ?? [])];
      const extraValues: Record<string, string> = {};
      let tokens = [...taskParts];
      if (tokens[0]?.startsWith("/")) {
        const shorthand = tokens[0].slice(1);
        skillNames.unshift(shorthand);
        tokens = tokens.slice(1);
        const found = (await loadSkills()).find((s) => s.name === shorthand);
        if (found) {
          found.args.forEach((arg, i) => { if (tokens[i] !== undefined) extraValues[arg.name] = tokens[i]; });
        }
      }
      const task = tokens.join(" ") || `Apply the ${skillNames.join(", ")} skill.`;

      let agentConfig;
      try {
        agentConfig = toAgentConfig(conf, opts);
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      }

      const { skills, error } = await resolveCliSkills(skillNames, opts.skillArg ?? [], extraValues);
      if (error) {
        console.error(chalk.red(error));
        process.exit(1);
      }
      agentConfig.skills = skills;

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
