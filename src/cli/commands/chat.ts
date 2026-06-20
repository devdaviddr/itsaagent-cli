import { intro, outro } from "@clack/prompts";
import chalk from "chalk";
import type { Command } from "commander";
import { AgentRuntime } from "../../agent/AgentRuntime.js";
import { SessionStore } from "../../agent/SessionStore.js";
import { setSessionCwd } from "../../tools/session.js";
import { loadConfig, toAgentConfig, SESSIONS_DIR } from "../config.js";
import { isInteractiveTTY } from "../output.js";
import { launchTui } from "../tui/launch.js";
import { resolveCliSkills } from "../skillResolve.js";
import { runChatSession } from "../chatSession.js";

export function registerChatCommand(program: Command): void {
  program
    .command("chat")
    .description("Interactive chat mode (slash commands: /agent, /agents, /model, /clear, /save, /help, /exit)")
    .option("--resume [id]", "Resume a saved session (latest if no id given). See `iaa sessions`.")
    .action(async (cmdOpts: { resume?: string | boolean }) => {
      const conf = await loadConfig();
      const opts = program.optsWithGlobals<{
        verbose?: boolean; log?: boolean; model?: string; host?: string;
        maxSteps?: number; agent?: string; skill?: string[]; skillArg?: string[];
      }>();

      // Resume: load the saved session and align agent/model to it before building config.
      const store = new SessionStore(SESSIONS_DIR);
      let restore;
      if (cmdOpts.resume !== undefined) {
        const id = typeof cmdOpts.resume === "string" ? cmdOpts.resume : await store.latestId();
        if (!id) {
          console.error(chalk.red("No saved sessions to resume. Start one with `iaa chat`."));
          process.exit(1);
        }
        restore = await store.load(id);
        if (!restore) {
          console.error(chalk.red(`No saved session "${id}". List them with \`iaa sessions\`.`));
          process.exit(1);
        }
        opts.agent = restore.agentId;
        opts.model = restore.model;
      }

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
      if (restore) {
        agentConfig.restore = restore;
        setSessionCwd(restore.cwd); // resume file tools in the session's directory
      }

      const runtime = new AgentRuntime(agentConfig);
      // Autosave the session after every turn so it can be resumed later.
      runtime.on("answer", () => { void store.save(runtime.session); });
      if (restore) console.error(chalk.dim(`  Resumed session ${restore.id} (${runtime.session.ctx.get().length} messages).\n`));
      const { ok } = await runtime.checkProvider();
      if (!ok) {
        console.error(chalk.red(`Cannot reach ${conf.providerType} at ${conf.host}`));
        process.exit(1);
      }

      // The persistent TUI needs a real terminal; fall back to the plain REPL when piped.
      if (isInteractiveTTY()) {
        await launchTui({ runtime, providerOk: ok, themeName: conf.theme, customTheme: conf.customTheme, mouse: conf.mouse });
        return;
      }

      intro(`ItsAAgent · ${agentConfig.provider.model}`);
      await runChatSession(runtime);
      outro("Goodbye.");
    });
}
