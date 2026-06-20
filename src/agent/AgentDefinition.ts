/**
 * An agent is a named persona with a scoped tool set and an optional
 * system-prompt extension. The active agent determines which tools the
 * model may call and what additional instructions it receives.
 */
export interface AgentDefinition {
  /** Invocation key, e.g. "build" — used by --agent and `iaa agents`. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** One-line description shown in `iaa agents`. */
  description: string;
  /** Permitted tool names, or "all" for unrestricted access. */
  tools: string[] | "all";
  /** When true, mutation tools are blocked regardless of the `tools` list. */
  readonly: boolean;
  /** Optional model override for this agent. */
  model?: string;
  /** Optional instructions appended to the system prompt after the rules block. */
  systemPromptSuffix?: string;
}

/**
 * Tools that change state. A `readonly` agent cannot call any of these even
 * if its `tools` list includes them. `git` is intentionally excluded — its
 * own tool blocks destructive subcommands, and read-only workflows rely on
 * `git status`/`diff`/`log`.
 */
export const MUTATION_TOOLS: ReadonlySet<string> = new Set([
  "write_file",
  "edit_file",
  "append_file",
  "delete_file",
  "bash",
  "ssh",
  "ssh_upload",
  "ssh_download",
]);

/** Whether an agent is allowed to call a tool by name (single source of truth). */
export function agentPermitsTool(agent: AgentDefinition, toolName: string): boolean {
  if (agent.readonly && MUTATION_TOOLS.has(toolName)) return false;
  if (agent.tools === "all") return true;
  return agent.tools.includes(toolName);
}

/** IDs reserved by built-in agents — user agents may not reuse them. */
export const BUILTIN_AGENT_IDS: ReadonlySet<string> = new Set(["build", "plan"]);

export const DEFAULT_AGENT_ID = "build";

/**
 * The three built-in agents. Tool lists may reference tools that are not yet
 * registered (e.g. `git`, `fetch`) — those are simply unavailable until the
 * corresponding tool ships. Permission is the intersection of this list with
 * the registered tool set.
 */
export const BUILTIN_AGENTS: AgentDefinition[] = [
  {
    id: "build",
    name: "Build",
    description: "Full-access development work — edit, run, commit",
    tools: "all",
    readonly: false,
  },
  {
    id: "plan",
    name: "Plan",
    description: "Read-only analysis and exploration — no mutations, no shell",
    tools: ["read_file", "glob", "grep", "git", "fetch"],
    readonly: true,
    systemPromptSuffix: [
      "## Plan Agent",
      "READ-ONLY mode: your only tools are read_file, glob, grep, git, fetch, and",
      "ask_user. Mutation tools (write/edit/bash/ssh) are blocked — never call them.",
      "Explore as needed; if anything is ambiguous, ask_user before planning. Then",
      "output a numbered, step-by-step plan as your final <answer> spelling out what",
      "build should do (files, commands, content) — do not do it yourself. Stop when",
      "the plan is ready; the user presses Tab to hand it to the build agent.",
    ].join("\n"),
  },
];
