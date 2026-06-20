import { execFileSync } from "node:child_process";

export interface GitContext {
  branch: string;
  /** Number of changed (staged + unstaged + untracked) entries. */
  changedCount: number;
  /** Changed entry lines from `git status --porcelain` (capped). */
  changed: string[];
  /** Recent commit subjects (`git log --oneline`, capped). */
  recentCommits: string[];
}

const MAX_CHANGED = 20;
const MAX_COMMITS = 5;

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf-8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** Read-only git state for the repo containing `cwd`, or null if not a repo. */
export function getGitContext(cwd: string): GitContext | null {
  const inside = git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (inside !== "true") return null;

  const branch = git(cwd, ["branch", "--show-current"]) || "(detached)";
  const statusRaw = git(cwd, ["status", "--porcelain"]) ?? "";
  const changed = statusRaw ? statusRaw.split("\n").filter(Boolean) : [];
  const logRaw = git(cwd, ["log", `-${MAX_COMMITS}`, "--oneline", "--no-decorate"]) ?? "";
  const recentCommits = logRaw ? logRaw.split("\n").filter(Boolean) : [];

  return {
    branch,
    changedCount: changed.length,
    changed: changed.slice(0, MAX_CHANGED),
    recentCommits,
  };
}

/** Render git context as a pinned prompt block. */
export function formatGitContext(g: GitContext): string {
  const lines = [`## Git`, `Branch: ${g.branch}`];
  if (g.changedCount === 0) {
    lines.push("Working tree: clean");
  } else {
    lines.push(`Working tree: ${g.changedCount} changed file(s):`);
    lines.push(...g.changed.map((c) => `  ${c}`));
    if (g.changedCount > g.changed.length) lines.push(`  …and ${g.changedCount - g.changed.length} more`);
  }
  if (g.recentCommits.length) {
    lines.push("Recent commits:");
    lines.push(...g.recentCommits.map((c) => `  ${c}`));
  }
  return lines.join("\n");
}

/** One-line summary for the TUI status line, e.g. "⎇ main · 3 changed". */
export function gitStatusLine(g: GitContext): string {
  return `⎇ ${g.branch} · ${g.changedCount === 0 ? "clean" : `${g.changedCount} changed`}`;
}
