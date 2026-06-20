import { readFileSync, statSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { homedir } from "node:os";

/** Filenames recognised as project context, in priority order within a directory. */
const CONTEXT_FILES = ["AGENTS.md"];

/** Cap injected context so a large file can't crowd the model's window (~2k tokens). */
const MAX_CHARS = 8000;

export interface ProjectContext {
  /** Absolute path of the file that was loaded. */
  path: string;
  /** File contents (capped to MAX_CHARS). */
  content: string;
  /** True when the file was longer than MAX_CHARS and was trimmed. */
  truncated: boolean;
}

/**
 * Find the NEAREST project-context file by walking up from `startDir` to the
 * filesystem root (not past the home directory's parent). Nearest wins — no
 * merging with ancestors. Returns null when none is found or it can't be read.
 */
export function findProjectContext(startDir: string, maxChars: number = MAX_CHARS): ProjectContext | null {
  let dir = startDir;
  const root = parse(dir).root;
  const home = homedir();
  // Walk up to (and including) the home directory or filesystem root.
  while (true) {
    for (const name of CONTEXT_FILES) {
      const candidate = join(dir, name);
      try {
        if (statSync(candidate).isFile()) {
          const raw = readFileSync(candidate, "utf-8");
          const truncated = raw.length > maxChars;
          return { path: candidate, content: truncated ? raw.slice(0, maxChars) : raw, truncated };
        }
      } catch {
        // not present / unreadable — keep walking
      }
    }
    const parent = dirname(dir);
    // Stop at the filesystem root, or once we've checked the home directory.
    if (parent === dir || dir === root || dir === home) break;
    dir = parent;
  }
  return null;
}

/** Render a project context for inclusion in the system prompt. */
export function formatProjectContext(ctx: ProjectContext): string {
  const note = ctx.truncated ? " (truncated)" : "";
  return [
    `## Project context (from ${ctx.path})${note}`,
    `Project-specific instructions and conventions. Follow them; they override general defaults.`,
    ``,
    ctx.content.trim(),
  ].join("\n");
}
