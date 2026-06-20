import chalk from "chalk";
import type { Command } from "commander";
import { AgentRuntime } from "../../agent/AgentRuntime.js";
import { AgentRegistry } from "../../agent/AgentRegistry.js";
import { getProcess } from "../../agent/Process.js";
import { loadConfig, toAgentConfig, CONFIG_PATH } from "../config.js";
import { runAgent, runProcessAgent, selectRenderMode, isInteractiveTTY } from "../output.js";
import { launchTui } from "../tui/launch.js";
import { resolveCliSkills } from "../skillResolve.js";
import { loadSkills } from "../../agent/SkillLoader.js";

export function registerRunCommand(program: Command): void {
  program
    .command("run <task...>")
    .description("Execute a task. Prefix with /skill-name to run a skill (e.g. run /refactor src/x.ts).")
    .option("-i, --interactive", "Open the persistent TUI seeded with the task (stays open for follow-ups)")
    .option("--process <id>", "Run an advised process end-to-end (e.g. 'guided': plan → build)")
    .action(async (taskParts: string[], cmdOpts: { interactive?: boolean; process?: string }) => {
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
        agentConfig = await toAgentConfig(conf, opts);
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

      // Advised process (e.g. --process guided): run the staged pipeline headless.
      if (cmdOpts.process) {
        const proc = getProcess(cmdOpts.process);
        if (!proc) {
          console.error(chalk.red(`Unknown process "${cmdOpts.process}". Available: guided`));
          process.exit(1);
        }
        const registry = await AgentRegistry.create();
        const answer = await runProcessAgent(runtime, registry, proc, task);
        console.log(answer);
        return;
      }

      const renderMode = selectRenderMode({
        isTTY: isInteractiveTTY(),
        interactive: Boolean(cmdOpts.interactive),
      });
      if (renderMode === "interactive") {
        await launchTui({ runtime, seedTask: task, providerOk: true, themeName: conf.theme, customTheme: conf.customTheme, mouse: conf.mouse });
        return;
      }

      const answer = await runAgent(runtime, task);
      console.log(answer);
    });
}
