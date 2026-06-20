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
  "make_directory",
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
    systemPromptSuffix: [
      "## Build Agent",
      "Take any task all the way to a complete, working result. Work this way for",
      "every kind of task — not one specific stack or project type:",
      "1. Plan first. If you were not handed a plan, begin by working out the goal,",
      "   the steps, and the files/commands involved before you act.",
      "2. Get what you need. If anything required to do it correctly is unknown or",
      "   ambiguous (a name, a choice, a value, missing context), call ask_user",
      "   instead of guessing — keep gathering what you need until you can do it right.",
      "3. Build the whole thing. Carry out every step in sequence and write complete,",
      "   runnable, best-practice code — full file contents via write_file, never",
      "   empty files or stubs. Do NOT stop at the first successful step or hand back",
      "   a half-finished result.",
      "4. Finish. Verify it works, then summarise. Only give your final answer once",
      "   the task is actually complete.",
    ].join("\n"),
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
      "Keep gathering information — read files, search, and ask_user about anything",
      "unknown or ambiguous — until you have everything needed to plan it correctly;",
      "don't guess past a gap. Then output a numbered, step-by-step plan as your final",
      "<answer> spelling out exactly what build should do (files, commands, content) —",
      "complete enough to build the whole thing — but do not do it yourself. Stop when",
      "the plan is ready; the user presses Tab to hand it to the build agent.",
    ].join("\n"),
  },
];
