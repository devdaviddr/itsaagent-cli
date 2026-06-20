/**
 * Shared session working directory. A real terminal is stateful: `cd` in one
 * command affects the next. The `bash` tool runs each command in a fresh shell,
 * so without this a `cd` would be lost and later commands (and file writes) would
 * run in the launch directory — dumping project files into the user's home.
 *
 * `bash` updates this when a command changes the directory; the file tools
 * resolve relative paths against it, so `cd project` then `write_file("x.js")`
 * lands inside `project/`.
 */
import { resolve, join, sep } from "node:path";
import { homedir } from "node:os";

let sessionCwd = process.cwd();

export function getSessionCwd(): string {
  return sessionCwd;
}

export function setSessionCwd(dir: string): void {
  if (dir) sessionCwd = dir;
}

/** Reset to the process cwd (used by tests). */
export function resetSessionCwd(): void {
  sessionCwd = process.cwd();
}

/** Expand a leading `~` to the home directory (the shell does this; Node's fs does not). */
export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith(`~/`) || p.startsWith(`~${sep}`)) return join(homedir(), p.slice(2));
  return p;
}

/** Resolve a tool path: expand `~`, then resolve relative paths against the session cwd. */
export function resolveSessionPath(p: string): string {
  return resolve(sessionCwd, expandHome(p));
}
