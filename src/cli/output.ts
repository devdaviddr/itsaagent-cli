import chalk from "chalk";
import type { AgentRuntime } from "../agent/AgentRuntime.js";
import type { AgentRegistry } from "../agent/AgentRegistry.js";
import type { ProcessDef } from "../agent/Process.js";
import { runProcess } from "../agent/ProcessRunner.js";
import { contextLine, usageLevel } from "./contextBar.js";

const isTTY = Boolean(process.stdout.isTTY && process.stderr.isTTY);

/** True when both streams are TTYs and the persistent TUI can render. */
export function isInteractiveTTY(): boolean {
  return isTTY;
}

export type RenderMode = "interactive" | "oneshot" | "plain";

/**
 * Decide how a `run` invocation should render. Non-TTY always falls back to the
 * plain renderer; an interactive TTY uses the persistent TUI only when opted in
 * (e.g. `iaa run -i`), otherwise the legacy one-shot view. Pure for testing.
 */
export function selectRenderMode(opts: { isTTY: boolean; interactive: boolean }): RenderMode {
  if (!opts.isTTY) return "plain";
  return opts.interactive ? "interactive" : "oneshot";
}

/** Colour the context indicator line by usage level. */
function colourContextLine(used: number, max: number, ratio: number): string {
  const line = contextLine(used, max, ratio);
  const level = usageLevel(ratio);
  if (level === "high") return chalk.red(line);
  if (level === "mid") return chalk.yellow(line);
  return chalk.dim(line);
}

export async function runAgent(runtime: AgentRuntime, task: string, continueChat = false): Promise<string> {
  return isTTY ? renderWithInk(runtime, task, continueChat) : renderPlain(runtime, task, continueChat);
}

/**
 * Run a multi-stage process (e.g. guided: plan → build) with plain progress
 * output, resolving on the FINAL stage's answer (unlike runAgent, which resolves
 * on the first). Each stage is announced; verbose mode streams thoughts/tools.
 */
export async function runProcessAgent(
  runtime: AgentRuntime,
  registry: AgentRegistry,
  proc: ProcessDef,
  task: string,
): Promise<string> {
  const verbose = runtime.verbose;
  if (verbose) {
    runtime.on("step", ({ index, total }) => console.error(chalk.bold(`\n[${index}/${total}]`)));
    runtime.on("thought", ({ text }) => console.error(chalk.yellow(`  thought: ${text.split("\n")[0]}`)));
    runtime.on("tool:call", ({ name, args }) => console.error(chalk.cyan(`  tool: ${name} ${JSON.stringify(args)}`)));
    runtime.on("tool:result", ({ result }) => {
      if (!result.success) console.error(chalk.red(`  error: ${result.error}`));
      else if (result.data) console.error(chalk.dim(`  result: ${(result.data.length > 120 ? result.data.slice(0, 120) + "…" : result.data).replace(/\n/g, " ")}`));
    });
  }
  runtime.on("ask", ({ question }) => console.error(chalk.magenta(`  ask: ${question}`)));

  const total = proc.stages.length;
  return runProcess(runtime, registry, proc, task, {
    onStage: (index, label, agentId) =>
      console.error(chalk.bold(`\n— Stage ${index + 1}/${total}: ${label} (${agentId}) —`)),
  });
}

async function renderWithInk(runtime: AgentRuntime, task: string, continueChat: boolean): Promise<string> {
  const { render } = await import("ink");
  const { createElement } = await import("react");
  const { AgentView } = await import("./tui/AgentView.js");

  return new Promise<string>((resolve, reject) => {
    const { waitUntilExit } = render(
      createElement(AgentView, {
        runtime,
        task,
        continueChat,
        onDone: resolve,
        onError: resolve,
      }),
    );

    waitUntilExit().catch(reject);
  });
}

async function renderPlain(runtime: AgentRuntime, task: string, continueChat: boolean): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const verbose = runtime.verbose;
    let lastUsage: { used: number; max: number; ratio: number } | undefined;

    runtime.on("context:usage", (u) => {
      lastUsage = u;
      // High-usage warning during the run (verbose only, to avoid noise).
      if (verbose && u.ratio >= 80) {
        console.error(colourContextLine(u.used, u.max, u.ratio));
      }
    });

    if (verbose) {
      runtime.on("start", ({ model, cwd, logPath }) => {
        console.error(chalk.bold(`\nItsAAgent  ${model}  ·  ${cwd}\n`));
        if (logPath) console.error(chalk.dim(`  log: ${logPath}`));
      });

      runtime.on("step", ({ index, total }) => {
        console.error(chalk.bold(`\n[${index}/${total}]`));
      });

      runtime.on("thought", ({ text }) => {
        console.error(chalk.yellow(`  thought: ${text.split("\n")[0]}`));
      });

      runtime.on("tool:call", ({ name, args }) => {
        console.error(chalk.cyan(`  tool: ${name} ${JSON.stringify(args)}`));
      });

      runtime.on("tool:result", ({ result }) => {
        if (!result.success) {
          console.error(chalk.red(`  error: ${result.error}`));
        } else if (result.data) {
          const preview = result.data.length > 120 ? result.data.slice(0, 120) + "…" : result.data;
          console.error(chalk.dim(`  result: ${preview.replace(/\n/g, " ")}`));
        }
      });

      runtime.on("context:evict", ({ evicted, ratio }) => {
        console.error(chalk.yellow(`  ⚠ context trimmed (${evicted} message(s) evicted, ${ratio}% full)`));
      });
    }

    runtime.on("answer", ({ text }) => {
      // Surface context fullness after a response when it's worth knowing.
      if (lastUsage && lastUsage.ratio >= 60) {
        console.error(colourContextLine(lastUsage.used, lastUsage.max, lastUsage.ratio));
      }
      resolve(text);
    });
    runtime.on("error", ({ error }) => resolve(error.message));

    if (continueChat) {
      runtime.continueChat(task).catch(reject);
    } else {
      runtime.run(task).catch(reject);
    }
  });
}
