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

/** IDs reserved by built-in agents — user agents may not reuse them. */
export const BUILTIN_AGENT_IDS: ReadonlySet<string> = new Set(["build", "plan", "cli"]);

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
      "You are in read-only planning mode. You cannot modify files, run shell",
      "commands, or connect to remote hosts. Your job is to read, analyse, and",
      "explain. When the task requires changes, describe precisely what should",
      "change and why — do not attempt to make the changes yourself.",
    ].join("\n"),
  },
  {
    id: "cli",
    name: "CLI",
    description: "Shell and infrastructure — commands, SSH, file transfer",
    tools: ["bash", "ssh", "ssh_upload", "ssh_download", "fetch", "download_file"],
    readonly: false,
    systemPromptSuffix: [
      "## CLI Agent",
      "You are in shell and infrastructure mode. Focus on running commands,",
      "managing remote hosts over SSH, and transferring files. You do not have",
      "direct filesystem read/edit tools — use shell commands (cat, sed, etc.)",
      "for file inspection and changes.",
    ].join("\n"),
  },
];
