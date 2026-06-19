import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Tool, ToolResult } from "../types.js";

const execFileAsync = promisify(execFile);

const ALLOWED = new Set(["status", "diff", "log", "add", "commit", "branch", "checkout", "show", "stash"]);
const MAX_OUTPUT = 6 * 1024;

/** Split an argument string into argv, respecting single and double quotes. */
export function tokenizeArgs(input: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (ch === " " || ch === "\t") {
      if (has) { out.push(cur); cur = ""; has = false; }
    } else {
      cur += ch;
      has = true;
    }
  }
  if (has) out.push(cur);
  return out;
}

export const gitTool: Tool = {
  definition: {
    name: "git",
    description:
      "Run a safe git subcommand: status, diff, log, add, commit, branch, checkout, show, stash. Destructive operations are blocked. commit requires -m.",
    parameters: {
      type: "object",
      properties: {
        subcommand: { type: "string", description: "One of: status, diff, log, add, commit, branch, checkout, show, stash" },
        args: { type: "string", description: "Additional arguments, e.g. '-m \"fix: typo\"' or '--staged'" },
        cwd: { type: "string", description: "Working directory (defaults to current)" },
      },
      required: ["subcommand"],
    },
  },
  async execute(args): Promise<ToolResult> {
    const subcommand = String(args.subcommand ?? "").trim();
    const argStr = String(args.args ?? "");
    const cwd = args.cwd ? String(args.cwd) : process.cwd();

    if (!ALLOWED.has(subcommand)) {
      return { success: false, data: "", error: "subcommand not permitted" };
    }

    const argv = tokenizeArgs(argStr);

    if (subcommand === "commit" && !argv.includes("-m") && !argv.some((a) => a.startsWith("--message"))) {
      return { success: false, data: "", error: "commit requires a message: pass args with -m \"your message\"" };
    }

    try {
      const { stdout, stderr } = await execFileAsync("git", [subcommand, ...argv], {
        cwd,
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
      });
      const out = stdout || stderr || "(no output)";
      const data = out.length > MAX_OUTPUT ? out.slice(0, MAX_OUTPUT) + "\n…[truncated]" : out;
      return { success: true, data, exitCode: 0 };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
      const detail = e.stderr || e.stdout || e.message || String(err);
      return { success: false, data: e.stdout ?? "", error: detail.slice(0, MAX_OUTPUT), exitCode: e.code ?? 1 };
    }
  },
};
