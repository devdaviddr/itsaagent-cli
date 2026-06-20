import { ContextManager } from "./ContextManager.js";
import type { AgentDefinition } from "./AgentDefinition.js";

export interface ToolHistoryEntry {
  name: string;
  args: Record<string, unknown>;
}

export interface AgentTransition {
  from?: string;
  to: string;
  at: number;
}

let counter = 0;
function newId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter.toString(36)}`;
}

export interface SessionOptions {
  id?: string;
  title?: string;
  agent?: AgentDefinition;
  model: string;
  cwd: string;
  maxTokens: number;
  onEvict?: (count: number) => void;
  onUsage?: (usage: { total: number; max: number; ratio: number }) => void;
}

/**
 * A chat session — the first-class owner of conversation context. The runtime is
 * an engine that operates on a session; the active agent can change within a
 * session (e.g. plan → build) without the session itself changing. The session
 * also records a structured tool history, used to build a compact handoff
 * summary when work passes from one agent to another.
 */
export class Session {
  readonly id: string;
  title: string;
  readonly createdAt: number;
  readonly ctx: ContextManager;
  agent?: AgentDefinition;
  model: string;
  cwd: string;
  readonly toolHistory: ToolHistoryEntry[] = [];
  readonly transitions: AgentTransition[] = [];

  constructor(opts: SessionOptions) {
    this.id = opts.id ?? newId();
    this.title = opts.title ?? "Untitled session";
    this.createdAt = Date.now();
    this.agent = opts.agent;
    this.model = opts.model;
    this.cwd = opts.cwd;
    // The digest is built from toolHistory (which is never trimmed), so "what was
    // done" survives in the eviction notice even after raw tool results are evicted.
    this.ctx = new ContextManager(opts.maxTokens, opts.onEvict, opts.onUsage, () => this.examinedSummary());
  }

  /** Active agent id, or "default" when the session is unscoped. */
  get agentId(): string {
    return this.agent?.id ?? "default";
  }

  /** Switch the active agent within this session; records the transition. */
  setAgent(def: AgentDefinition): void {
    this.transitions.push({ from: this.agent?.id, to: def.id, at: Date.now() });
    this.agent = def;
  }

  /** Record a tool invocation (used to build a compact handoff summary). */
  recordTool(name: string, args: Record<string, unknown>): void {
    this.toolHistory.push({ name, args });
  }

  /**
   * A deterministic, compact summary of what this session examined/did — files
   * read or searched, commands run, files written or edited. No LLM call; built
   * purely from the recorded tool history. Used to seed a handoff so the next
   * agent inherits *what was learned* without the raw tool-result dumps.
   */
  examinedSummary(): string {
    const reads = new Set<string>();
    const searches = new Set<string>();
    const commands: string[] = [];
    const writes = new Set<string>();
    for (const { name, args } of this.toolHistory) {
      const path = typeof args.path === "string" ? args.path : undefined;
      switch (name) {
        case "read_file":
          if (path) reads.add(path);
          break;
        case "glob":
        case "grep":
          if (typeof args.pattern === "string") searches.add(args.pattern);
          break;
        case "bash":
          if (typeof args.command === "string") commands.push(args.command);
          break;
        case "write_file":
        case "edit_file":
        case "append_file":
          if (path) writes.add(path);
          break;
      }
    }
    const lines: string[] = [];
    if (reads.size) lines.push(`- Files read: ${[...reads].join(", ")}`);
    if (searches.size) lines.push(`- Searched: ${[...searches].join(", ")}`);
    if (commands.length) lines.push(`- Commands run: ${commands.slice(0, 10).join("; ")}`);
    if (writes.size) lines.push(`- Files written/edited: ${[...writes].join(", ")}`);
    return lines.length ? lines.join("\n") : "- (nothing was examined during planning)";
  }
}
