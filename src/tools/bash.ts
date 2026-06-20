import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import type { Tool, ToolResult } from "../types.js";
import { getSessionCwd, setSessionCwd, resolveSessionPath } from "./session.js";

const execFileAsync = promisify(execFile);

// Unique marker used to read back the working directory after a command runs, so
// `cd` persists to subsequent calls (each bash -c is otherwise a fresh shell).
const CWD_MARKER = "__IAA_CWD__";

/** Strip the trailing cwd marker from stdout and return the captured directory. */
function extractCwd(stdout: string): { output: string; cwd?: string } {
  const idx = stdout.lastIndexOf(CWD_MARKER);
  if (idx === -1) return { output: stdout };
  const cwd = stdout.slice(idx + CWD_MARKER.length).split("\n")[0].trim();
  let output = stdout.slice(0, idx);
  if (output.endsWith("\n")) output = output.slice(0, -1);
  return { output, cwd: cwd || undefined };
}

export const bashTool: Tool = {
  definition: {
    name: "bash",
    description:
      "Execute a bash command on the host system. Returns stdout, stderr, and exit code. The working directory PERSISTS across calls — a `cd` carries over to later bash commands and to file tools (write_file, etc.), like a real terminal. Pass `cwd` to run inside a specific directory (e.g. a project folder) so the command doesn't run in the home directory.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The bash command to execute" },
        cwd: { type: "string", description: "Optional directory to run the command in (must already exist). Persists as the working directory afterwards, like cd." },
        timeout: { type: "number", description: "Timeout in milliseconds (default: 30000)" },
      },
      required: ["command"],
    },
  },
  async execute(args): Promise<ToolResult> {
    const command = String(args.command ?? "");
    const timeout = Number(args.timeout ?? 30000);
    let cwd = getSessionCwd();
    if (args.cwd !== undefined && args.cwd !== null && String(args.cwd) !== "") {
      const requested = resolveSessionPath(String(args.cwd));
      const info = await stat(requested).catch(() => null);
      if (!info || !info.isDirectory()) {
        return { success: false, data: "", error: `cwd does not exist or is not a directory: ${requested}. Create it first with make_directory.` };
      }
      cwd = requested;
    }
    // Run the command, then print the resulting directory so `cd` persists.
    const wrapped = `${command}\n__iaa_rc=$?\nprintf '\\n${CWD_MARKER}%s' "$(pwd)"\nexit $__iaa_rc`;

    try {
      const { stdout, stderr } = await execFileAsync("bash", ["-c", wrapped], {
        cwd,
        timeout,
        maxBuffer: 10 * 1024 * 1024,
      });
      const { output, cwd: next } = extractCwd(stdout);
      if (next) setSessionCwd(next);
      return { success: true, data: output, error: stderr || undefined, exitCode: 0 };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
      const { output, cwd: next } = extractCwd(e.stdout ?? "");
      if (next) setSessionCwd(next); // a `cd` may have succeeded before a later failure
      return {
        success: false,
        data: output,
        error: e.stderr || e.message || String(err),
        exitCode: e.code ?? 1,
      };
    }
  },
};
