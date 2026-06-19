import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Tool, ToolResult } from "../types.js";

const execFileAsync = promisify(execFile);

export const bashTool: Tool = {
  definition: {
    name: "bash",
    description: "Execute a bash command on the host system. Returns stdout, stderr, and exit code.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The bash command to execute" },
        timeout: { type: "number", description: "Timeout in milliseconds (default: 30000)" },
      },
      required: ["command"],
    },
  },
  async execute(args): Promise<ToolResult> {
    const command = String(args.command ?? "");
    const timeout = Number(args.timeout ?? 30000);

    try {
      const { stdout, stderr } = await execFileAsync("bash", ["-c", command], {
        timeout,
        maxBuffer: 10 * 1024 * 1024,
      });
      return { success: true, data: stdout, error: stderr || undefined, exitCode: 0 };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
      return {
        success: false,
        data: e.stdout ?? "",
        error: e.stderr || e.message || String(err),
        exitCode: e.code ?? 1,
      };
    }
  },
};
