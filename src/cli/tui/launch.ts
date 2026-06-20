/**
 * Entry point for the persistent TUI. Builds the agent list from the registry,
 * renders the App inside the alternate screen buffer (so the user's scrollback is
 * restored on exit), and resolves when the user quits.
 */
import type { AgentRuntime } from "../../agent/AgentRuntime.js";
import { AgentRegistry } from "../../agent/AgentRegistry.js";
import { BUILTIN_AGENT_IDS } from "../../agent/AgentDefinition.js";
import { AgentRuntime as Runtime } from "../../agent/AgentRuntime.js";
import { loadConfig, toAgentConfig } from "../config.js";
import type { AppAgentInfo } from "./App.js";

export interface LaunchTuiOptions {
  runtime: AgentRuntime;
  seedTask?: string;
  providerOk?: boolean;
  themeName?: string;
}

export async function launchTui(opts: LaunchTuiOptions): Promise<void> {
  const registry = await AgentRegistry.create();
  const agents: AppAgentInfo[] = registry.list().map((a) => ({
    id: a.id,
    description: a.description,
    builtin: BUILTIN_AGENT_IDS.has(a.id),
  }));
  const resolveAgent = (name: string) => registry.get(name);

  const { render, preserveScreen } = await import("tuir");
  const { createElement } = await import("react");
  const { App } = await import("./App.js");

  // preserveScreen() saves/restores the terminal (alternate-screen equivalent).
  preserveScreen();
  const { waitUntilExit } = render(
    createElement(App, {
      runtime: opts.runtime,
      agents,
      resolveAgent,
      seedTask: opts.seedTask,
      providerOk: opts.providerOk ?? true,
      themeName: opts.themeName,
    }),
    // throttle coalesces spinner ticks + keystrokes into fewer frames.
    { exitOnCtrlC: false, throttle: 16 },
  );
  await waitUntilExit();
}

/** Build a default runtime from config and launch the TUI (used for the no-arg `iaa`). */
export async function launchHomeTui(): Promise<void> {
  const conf = await loadConfig();
  const agentConfig = await toAgentConfig(conf, {});
  const runtime = new Runtime(agentConfig);
  const { ok } = await runtime.checkProvider();
  await launchTui({ runtime, providerOk: ok, themeName: conf.theme });
}
