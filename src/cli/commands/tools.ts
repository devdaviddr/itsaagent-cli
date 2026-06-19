import chalk from "chalk";
import type { Command } from "commander";
import { getDefaultTools } from "../../tools/index.js";
import { BUILTIN_AGENTS, agentPermitsTool } from "../../agent/AgentDefinition.js";
import type { Tool } from "../../types.js";

/** Built-in agent ids that permit the given tool. */
export function agentsPermitting(toolName: string): string[] {
  return BUILTIN_AGENTS.filter((a) => agentPermitsTool(a, toolName)).map((a) => a.id);
}

export function formatToolList(tools: Tool[]): string {
  const lines = tools.map((t) => {
    const req = t.definition.parameters.required;
    const reqStr = req.length ? chalk.dim(`[${req.join(", ")}]`) : "";
    return `  ${chalk.cyan(t.definition.name.padEnd(15))} ${t.definition.description}  ${reqStr}`;
  });
  return [chalk.bold(`\nBuilt-in tools (${tools.length}):`), ...lines, "", chalk.dim("Run `iaa tools <name>` for full parameter detail.")].join("\n");
}

export function formatToolDetail(tool: Tool): string {
  const p = tool.definition.parameters;
  const required = new Set(p.required);
  const params = Object.entries(p.properties).map(([name, spec]) => {
    const flag = required.has(name) ? chalk.yellow("(required)") : chalk.dim("(optional)");
    return `  ${chalk.cyan(name.padEnd(12))} ${spec.type.padEnd(8)} ${flag}  ${spec.description}`;
  });
  return [
    `\n${chalk.bold(tool.definition.name)} — ${tool.definition.description}`,
    params.length ? chalk.bold("Parameters:") : chalk.dim("Parameters: (none)"),
    ...params,
    chalk.dim(`Permitted by: ${agentsPermitting(tool.definition.name).join(", ") || "none"}`),
  ].join("\n");
}

export function registerToolsCommand(program: Command): void {
  program
    .command("tools [name]")
    .description("List built-in tools, or show full detail for one tool")
    .action((name?: string) => {
      const tools = getDefaultTools();
      if (!name) {
        console.log(formatToolList(tools));
        return;
      }
      const tool = tools.find((t) => t.definition.name === name);
      if (!tool) {
        console.error(chalk.red(`No such tool "${name}".`));
        console.error(chalk.dim(`Available: ${tools.map((t) => t.definition.name).join(", ")}`));
        process.exit(1);
      }
      console.log(formatToolDetail(tool));
    });
}
