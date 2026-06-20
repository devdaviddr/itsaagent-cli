import { execFile } from "node:child_process";
import { readFile, writeFile, mkdir, stat, appendFile, unlink, rmdir, realpath } from "node:fs/promises";
import { dirname, resolve, sep, join } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import fg from "fast-glob";
import type { Tool, ToolResult } from "../types.js";

const execFileAsync = promisify(execFile);

/**
 * Expand a leading `~` to the user's home directory. The shell does this (so the
 * `bash` tool already handles `~/Desktop/…`), but Node's `fs`/`path` treat `~`
 * as a literal folder name — so file tools must expand it themselves, otherwise
 * `~/Desktop/x` is written to `<cwd>/~/Desktop/x`.
 */
export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith(`~/`) || p.startsWith(`~${sep}`)) return join(homedir(), p.slice(2));
  return p;
}

/** Files larger than this must be read with a line range, not whole. */
const READ_FILE_MAX_BYTES = 150 * 1024;

/** Max redirects followed by download_file. */
const DOWNLOAD_MAX_REDIRECTS = 5;
const DOWNLOAD_TIMEOUT_MS = 120_000;

/** Fetch following at most `max` redirects manually, then return the final response. */
async function fetchWithRedirectLimit(url: string, max: number, signal: AbortSignal): Promise<Response> {
  let current = url;
  let redirects = 0;
  while (true) {
    const res = await fetch(current, { redirect: "manual", signal });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      redirects++;
      if (redirects > max) throw new Error(`Too many redirects (>${max})`);
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
}

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
    const path = expandHome(String(args.path ?? ""));
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
    const path = expandHome(String(args.path ?? ""));
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

export const appendFileTool: Tool = {
  definition: {
    name: "append_file",
    description: "Append content to the end of a file without overwriting it. Creates the file if it does not exist.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative path to the file" },
        content: { type: "string", description: "Content to append (no trailing newline is added)" },
      },
      required: ["path", "content"],
    },
  },
  async execute(args): Promise<ToolResult> {
    const path = expandHome(String(args.path ?? ""));
    const content = String(args.content ?? "");
    try {
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, content, "utf-8");
      const info = await stat(path);
      return { success: true, data: `Appended ${content.length} bytes to ${path} (file is now ${info.size} bytes total)` };
    } catch (err: unknown) {
      return { success: false, data: "", error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const editFileTool: Tool = {
  definition: {
    name: "edit_file",
    description:
      "Replace lines start_line..end_line (1-indexed, inclusive) of a file with new_content. To insert before a line without removing anything, set end_line = start_line - 1. Returns a unified diff.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative path to the file" },
        start_line: { type: "number", description: "1-indexed first line to replace (inclusive)" },
        end_line: { type: "number", description: "1-indexed last line to replace (inclusive); use start_line-1 to insert" },
        new_content: { type: "string", description: "Replacement text (empty string deletes the range)" },
      },
      required: ["path", "start_line", "end_line", "new_content"],
    },
  },
  async execute(args): Promise<ToolResult> {
    const path = expandHome(String(args.path ?? ""));
    const start = Number(args.start_line);
    const end = Number(args.end_line);
    const newContent = String(args.new_content ?? "");
    try {
      let original: string;
      try {
        original = await readFile(path, "utf-8");
      } catch {
        return { success: false, data: "", error: `No such file: ${path}` };
      }
      const lines = original.split("\n");
      const total = lines.length;

      // Insertion: end = start - 1, nothing removed.
      const isInsert = end === start - 1;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1) {
        return { success: false, data: "", error: `Invalid range: start_line=${start}, end_line=${end}` };
      }
      if (!isInsert && end < start) {
        return { success: false, data: "", error: `end_line (${end}) is before start_line (${start})` };
      }
      if (start > total + 1 || (!isInsert && end > total)) {
        return { success: false, data: "", error: `line ${Math.max(start, end)} out of range (file has ${total} lines)` };
      }

      const replacement = newContent === "" ? [] : newContent.split("\n");
      const removeCount = isInsert ? 0 : end - start + 1;
      const after = [...lines];
      after.splice(start - 1, removeCount, ...replacement);
      const updated = after.join("\n");
      await writeFile(path, updated, "utf-8");

      const removed = isInsert ? [] : lines.slice(start - 1, end);
      const diff = [
        `--- ${path} (before)`,
        `+++ ${path} (after)`,
        `@@ -${start},${removed.length} +${start},${replacement.length} @@`,
        ...removed.map((l) => `-${l}`),
        ...replacement.map((l) => `+${l}`),
      ].join("\n");
      return { success: true, data: diff };
    } catch (err: unknown) {
      return { success: false, data: "", error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const deleteFileTool: Tool = {
  definition: {
    name: "delete_file",
    description: "Delete a single file or empty directory. Refuses wildcards and paths inside .git.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to a single file or empty directory (no wildcards)" },
      },
      required: ["path"],
    },
  },
  async execute(args): Promise<ToolResult> {
    const path = expandHome(String(args.path ?? ""));
    if (/[*?[]/.test(path)) {
      return { success: false, data: "", error: "Wildcards not allowed. Use glob to find files, then delete individually." };
    }
    const resolved = resolve(path);
    if (resolved.split(sep).includes(".git")) {
      return { success: false, data: "", error: "Refusing to delete paths inside .git" };
    }
    try {
      const info = await stat(resolved);
      if (info.isDirectory()) {
        try {
          await rmdir(resolved); // fails if not empty
        } catch {
          return { success: false, data: "", error: "Directory is not empty. Delete contents first or use bash." };
        }
        return { success: true, data: `Deleted directory ${resolved}` };
      }
      const size = info.size;
      await unlink(resolved);
      return { success: true, data: `Deleted ${resolved} (${size} bytes)` };
    } catch (err: unknown) {
      return { success: false, data: "", error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const downloadFileTool: Tool = {
  definition: {
    name: "download_file",
    description: "Download a URL to a local file path. Streams to disk with no size limit (unlike fetch). HTTP/HTTPS only.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "HTTP(S) URL to download" },
        destination: { type: "string", description: "Local file path to write the response body to" },
      },
      required: ["url", "destination"],
    },
  },
  async execute(args): Promise<ToolResult> {
    const url = String(args.url ?? "");
    const destination = expandHome(String(args.destination ?? ""));
    if (!/^https?:\/\//i.test(url)) {
      return { success: false, data: "", error: "Only http:// and https:// URLs are supported" };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const res = await fetchWithRedirectLimit(url, DOWNLOAD_MAX_REDIRECTS, controller.signal);
      if (!res.ok || !res.body) {
        return { success: false, data: "", error: `Download failed: HTTP ${res.status}` };
      }
      await mkdir(dirname(resolve(destination)), { recursive: true });
      const out = createWriteStream(destination);
      await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), out);
      const info = await stat(destination);
      const contentType = res.headers.get("content-type") ?? "unknown";
      return { success: true, data: `Downloaded ${url} → ${destination} (${info.size} bytes, ${contentType})` };
    } catch (err: unknown) {
      const msg = err instanceof Error && err.name === "AbortError"
        ? `Download timed out after ${DOWNLOAD_TIMEOUT_MS / 1000}s`
        : err instanceof Error ? err.message : String(err);
      return { success: false, data: "", error: msg };
    } finally {
      clearTimeout(timer);
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
