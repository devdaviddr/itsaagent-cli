import chalk from "chalk";
import type { AgentRuntime } from "../agent/AgentRuntime.js";

const isTTY = Boolean(process.stdout.isTTY && process.stderr.isTTY);

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

    runtime.on("answer", ({ text }) => resolve(text));
    runtime.on("error", ({ error }) => resolve(error.message));

    if (continueChat) {
      runtime.continueChat(task).catch(reject);
    } else {
      runtime.run(task).catch(reject);
    }
  });
}
