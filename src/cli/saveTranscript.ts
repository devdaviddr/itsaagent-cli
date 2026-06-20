import { writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import type { Session } from "../agent/Session.js";
import { formatSessionTranscript } from "../agent/sessionTranscript.js";

function expandHome(p: string): string {
  return p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(1)) : p;
}

function stamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Write the full session transcript to a file and return its absolute path.
 * With no `requestedPath`, defaults to `<logDir>/session-<id>-<stamp>.md`.
 * A relative path resolves against the current directory.
 */
export async function saveSessionTranscript(
  session: Session,
  requestedPath: string | undefined,
  logDir: string | undefined,
): Promise<string> {
  let target: string;
  const req = requestedPath?.trim();
  if (req) {
    target = expandHome(req);
    if (!isAbsolute(target)) target = join(process.cwd(), target);
  } else {
    const dir = expandHome(logDir?.trim() || join(homedir(), ".config", "ai-cli", "logs"));
    target = join(dir, `session-${session.id}-${stamp()}.md`);
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, formatSessionTranscript(session), "utf-8");
  return target;
}
