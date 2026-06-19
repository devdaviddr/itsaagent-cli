import chalk from "chalk";
import type { AgentRuntime } from "../agent/AgentRuntime.js";
import { contextLine, usageLevel } from "./contextBar.js";

const isTTY = Boolean(process.stdout.isTTY && process.stderr.isTTY);

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
