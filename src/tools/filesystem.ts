import { execFile } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import fg from "fast-glob";
import type { Tool, ToolResult } from "../types.js";

const execFileAsync = promisify(execFile);

export const readFileTool: Tool = {
  definition: {
    name: "read_file",
    description: "Read the contents of a file from the filesystem.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative path to the file" },
      },
      required: ["path"],
    },
  },
  async execute(args): Promise<ToolResult> {
    const path = String(args.path ?? "");
    try {
      const content = await readFile(path, "utf-8");
      return { success: true, data: content };
    } catch (err: unknown) {
      return { success: false, data: "", error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const writeFileTool: Tool = {
  definition: {
    name: "write_file",
    description: "Write content to a file. Creates parent directories if needed.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative path to the file" },
        content: { type: "string", description: "Content to write" },
      },
      required: ["path", "content"],
    },
  },
  async execute(args): Promise<ToolResult> {
    const path = String(args.path ?? "");
    const content = String(args.content ?? "");
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf-8");
      return { success: true, data: `Wrote ${content.length} bytes to ${path}` };
    } catch (err: unknown) {
      return { success: false, data: "", error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const globTool: Tool = {
  definition: {
    name: "glob",
    description: "Find files and directories matching a glob pattern (e.g. '**/*.ts', 'src/**/*').",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern to search" },
        cwd: { type: "string", description: "Directory to search from (default: current directory)" },
      },
      required: ["pattern"],
    },
  },
  async execute(args): Promise<ToolResult> {
    const pattern = String(args.pattern ?? "");
    const cwd = args.cwd ? String(args.cwd) : process.cwd();
    try {
      const files = await fg(pattern, { dot: true, absolute: false, cwd });
      return { success: true, data: files.length > 0 ? files.join("\n") : "(no matches)" };
    } catch (err: unknown) {
      return { success: false, data: "", error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const grepTool: Tool = {
  definition: {
    name: "grep",
    description: "Search file contents using ripgrep or grep. Returns matching file:line:content.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Search pattern (regex)" },
        path: { type: "string", description: "Directory or file to search (default: current dir)" },
        include: { type: "string", description: "Only search files matching this glob (e.g. '*.ts')" },
      },
      required: ["pattern"],
    },
  },
  async execute(args): Promise<ToolResult> {
    const pattern = String(args.pattern ?? "");
    const searchPath = String(args.path ?? ".");
    const include = args.include ? String(args.include) : null;

    const rgArgs = ["-n", "--no-heading"];
    if (include) rgArgs.push("--glob", include);
    rgArgs.push(pattern, searchPath);

    const grepArgs = ["-rn"];
    if (include) grepArgs.push(`--include=${include}`);
    grepArgs.push(pattern, searchPath);

    try {
      const { stdout } = await execFileAsync("rg", rgArgs, { timeout: 15000 }).catch(() =>
        execFileAsync("grep", grepArgs, { timeout: 15000 }),
      );
      return { success: true, data: stdout || "no matches", exitCode: 0 };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number };
      // exit code 1 from grep/rg means no matches — not an error
      if (e.code === 1) return { success: true, data: "no matches", exitCode: 1 };
      return { success: false, data: "", error: e.stderr || String(err) };
    }
  },
};
