import chalk from "chalk";
import type { Command } from "commander";
import { AgentRegistry } from "../../agent/AgentRegistry.js";
import { MUTATION_TOOLS, BUILTIN_AGENT_IDS, type AgentDefinition } from "../../agent/AgentDefinition.js";
import { getDefaultTools } from "../../tools/index.js";

/** Tool names this agent can actually call, given the registered tool set. */
function effectiveTools(agent: AgentDefinition, registered: string[]): string[] {
  let names = agent.tools === "all" ? [...registered] : agent.tools.filter((t) => registered.includes(t));
  if (agent.readonly) names = names.filter((t) => !MUTATION_TOOLS.has(t));
  return names;
}

export function registerAgentsCommand(program: Command): void {
  program
    .command("agents")
    .description("List available agents and their tool access")
    .action(async () => {
      const registry = await AgentRegistry.create();
      const registered = getDefaultTools().map((t) => t.definition.name);

      console.log(chalk.bold("\nAvailable agents:\n"));
      for (const agent of registry.list()) {
        const count = agent.tools === "all"
          ? "all tools"
          : `${effectiveTools(agent, registered).length} tools`;
        const tag = BUILTIN_AGENT_IDS.has(agent.id) ? "" : chalk.magenta(" [custom]");
        const ro = agent.readonly ? chalk.yellow(" [read-only]") : "";
        console.log(`  ${chalk.cyan(agent.id.padEnd(8))} ${agent.description}${tag}${ro}`);
        console.log(`  ${" ".repeat(8)} ${chalk.dim(count)}\n`);
      }
    });
}
