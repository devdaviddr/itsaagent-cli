import { execFile } from "node:child_process";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import fg from "fast-glob";
import type { Tool, ToolResult } from "../types.js";

const execFileAsync = promisify(execFile);

/** Files larger than this must be read with a line range, not whole. */
const READ_FILE_MAX_BYTES = 150 * 1024;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const readFileTool: Tool = {
  definition: {
    name: "read_file",
    description:
      "Read a file. For files over 300 lines, pass start_line and end_line to read only a section. Files over 150 KB must be read with a range.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative path to the file" },
        start_line: { type: "number", description: "Optional 1-indexed first line to read (inclusive)" },
        end_line: { type: "number", description: "Optional 1-indexed last line to read (inclusive)" },
      },
      required: ["path"],
    },
  },
  async execute(args): Promise<ToolResult> {
    const path = String(args.path ?? "");
    const hasStart = args.start_line !== undefined && args.start_line !== null;
    const hasEnd = args.end_line !== undefined && args.end_line !== null;
    try {
      // Size guard: only enforced when reading the whole file (no range given).
      if (!hasStart && !hasEnd) {
        const info = await stat(path);
        if (info.size > READ_FILE_MAX_BYTES) {
          return {
            success: false,
            data: "",
            error: `File is ${formatBytes(info.size)} — too large to read whole (limit: ${formatBytes(READ_FILE_MAX_BYTES)}). Use start_line/end_line to read a section, or grep to search it.`,
          };
        }
      }

      const content = await readFile(path, "utf-8");

      if (!hasStart && !hasEnd) {
        return { success: true, data: content };
      }

      const lines = content.split("\n");
      const total = lines.length;
      const start = hasStart ? Number(args.start_line) : 1;
      const end = hasEnd ? Number(args.end_line) : total;

      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
        return { success: false, data: "", error: `Invalid range: start_line=${start}, end_line=${end} (must be 1-indexed, start ≤ end)` };
      }
      if (start > total) {
        return { success: false, data: "", error: `start_line ${start} out of range (file has ${total} lines)` };
      }

      const clampedEnd = Math.min(end, total);
      const slice = lines.slice(start - 1, clampedEnd).join("\n");
      return { success: true, data: `[Lines ${start}–${clampedEnd} of ${total} in ${path}]\n${slice}` };
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
