import { BUILTIN_AGENTS, type AgentDefinition } from "./AgentDefinition.js";
import { loadUserAgents } from "./AgentLoader.js";

/**
 * Holds the set of available agents. In v0.2.0 this is the three built-ins;
 * A-02 extends it to load user-defined agents from disk.
 */
export class AgentRegistry {
  private readonly agents = new Map<string, AgentDefinition>();

  constructor(definitions: AgentDefinition[] = BUILTIN_AGENTS) {
    for (const def of definitions) {
      this.agents.set(def.id, def);
    }
  }

  /** Look up an agent by id. */
  get(id: string): AgentDefinition | undefined {
    return this.agents.get(id);
  }

  /** True if an agent with this id is registered. */
  has(id: string): boolean {
    return this.agents.has(id);
  }

  /** All registered agents, in insertion order (built-ins first). */
  list(): AgentDefinition[] {
    return [...this.agents.values()];
  }

  /** Register or replace an agent. Used by the user-agent loader (A-02). */
  add(def: AgentDefinition): void {
    this.agents.set(def.id, def);
  }

  /** Built-in IDs are reserved and must not be overwritten by user agents. */
  isBuiltin(id: string): boolean {
    return BUILTIN_AGENTS.some((a) => a.id === id);
  }

  /** Create a registry of built-in plus user-defined agents. */
  static async create(): Promise<AgentRegistry> {
    const registry = new AgentRegistry();
    for (const agent of await loadUserAgents()) {
      if (!registry.isBuiltin(agent.id)) registry.add(agent);
    }
    return registry;
  }
}
