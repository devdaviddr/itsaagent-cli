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
import type { ThemeOverrides } from "./theme.js";

export interface LaunchTuiOptions {
  runtime: AgentRuntime;
  seedTask?: string;
  providerOk?: boolean;
  themeName?: string;
  customTheme?: ThemeOverrides;
  /** Enable mouse/trackpad wheel scroll (disables native text selection). */
  mouse?: boolean;
}

export async function launchTui(opts: LaunchTuiOptions): Promise<void> {
  const registry = await AgentRegistry.create();
  const agents: AppAgentInfo[] = registry.list().map((a) => ({
    id: a.id,
    description: a.description,
    builtin: BUILTIN_AGENT_IDS.has(a.id),
  }));
  const resolveAgent = (name: string) => registry.get(name);

  const { render, preserveScreen, setMouseReporting } = await import("tuir");
  const { createElement } = await import("react");
  const { App } = await import("./App.js");

  // preserveScreen() saves/restores the terminal (alternate-screen equivalent).
  preserveScreen();
  // Mouse/trackpad wheel scroll is opt-in (config `mouse: true`) — enabling it
  // captures mouse events, which disables native terminal text-selection/copy.
  if (opts.mouse) setMouseReporting(true);
  const { waitUntilExit } = render(
    createElement(App, {
      runtime: opts.runtime,
      agents,
      resolveAgent,
      seedTask: opts.seedTask,
      providerOk: opts.providerOk ?? true,
      themeName: opts.themeName,
      customTheme: opts.customTheme,
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
  await launchTui({ runtime, providerOk: ok, themeName: conf.theme, customTheme: conf.customTheme, mouse: conf.mouse });
}
