import chalk from "chalk";
import type { AgentRuntime } from "../agent/AgentRuntime.js";

const isTTY = Boolean(process.stdout.isTTY && process.stderr.isTTY);

export async function runAgent(runtime: AgentRuntime, task: string): Promise<string> {
  return isTTY ? renderWithInk(runtime, task) : renderPlain(runtime, task);
}

async function renderWithInk(runtime: AgentRuntime, task: string): Promise<string> {
  const { render } = await import("ink");
  const { createElement } = await import("react");
  const { AgentView } = await import("./tui/AgentView.js");

  return new Promise<string>((resolve, reject) => {
    // AgentView registers all listeners and calls runtime.run() inside its own useEffect,
    // so there is no race between event emission and listener registration.
    const { waitUntilExit } = render(
      createElement(AgentView, {
        runtime,
        task,
        onDone: resolve,
        onError: resolve,  // error already shown in TUI; resolve so process exits cleanly
      }),
    );

    waitUntilExit().catch(reject);
  });
}

async function renderPlain(runtime: AgentRuntime, task: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const verbose = runtime.verbose;

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
    }

    runtime.on("answer", ({ text }) => resolve(text));
    runtime.on("error", ({ error }) => resolve(error.message));

    runtime.run(task).catch(reject);
  });
}
