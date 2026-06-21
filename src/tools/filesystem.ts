import { execFile } from "node:child_process";
import { readFile, writeFile, mkdir, stat, appendFile, unlink, rmdir, realpath } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import fg from "fast-glob";
import type { Tool, ToolResult } from "../types.js";
import { resolveSessionPath, getSessionCwd } from "./session.js";

const execFileAsync = promisify(execFile);

// Re-exported for callers/tests; expansion now lives in the shared session module.
export { expandHome } from "./session.js";

/**
 * Small models sometimes double-escape newlines, emitting a whole multi-line file
 * as ONE line with literal `\n` (backslash-n) text instead of real line breaks.
 * If a string has NO real newlines but contains 2+ literal `\n` sequences, that's
 * almost certainly the mistake — restore real newlines/tabs. Guarded so genuine
 * single-line content (which rarely has 2+ literal `\n`) is left untouched.
 */
export function restoreCollapsedNewlines(content: string): string {
  if (content.includes("\n")) return content; // already multi-line — trust it
  if ((content.match(/\\n/g) ?? []).length < 2) return content; // not enough signal
  return content
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "\r");
}

/**
 * Result of locating an edit span: either the original-file offsets to replace
 * plus which strategy matched (and at what 1-indexed line), or a clear error.
 */
export type LocateEditResult =
  | { start: number; end: number; strategy: string }
  | { error: string };

/** Collapse a single line's leading/trailing whitespace and internal runs of
 * spaces/tabs to one space. Used by the whitespace-normalized matcher. */
function normalizeLine(line: string): string {
  return line.replace(/[\t ]+/g, " ").trim();
}

/**
 * Build a whitespace-normalized version of `content` while tracking, for each
 * character in the normalized string, the offset in the ORIGINAL string it came
 * from. The returned `map` has `normalized.length + 1` entries: map[i] is the
 * original offset where normalized[i] begins, and map[normalized.length] is the
 * original offset just past the last consumed character.
 */
function normalizeWithMap(content: string): { normalized: string; map: number[] } {
  const lines = content.split("\n");
  let normalized = "";
  const map: number[] = [];
  let origPos = 0;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    let i = 0;
    const n = line.length;
    // skip leading whitespace
    while (i < n && (line[i] === " " || line[i] === "\t")) i++;
    while (i < n) {
      const ch = line[i];
      if (ch === " " || ch === "\t") {
        // start of a whitespace run — emit one space mapped to the run's start
        const runStart = origPos + i;
        while (i < n && (line[i] === " " || line[i] === "\t")) i++;
        // only emit the space if more non-ws follows (trailing ws is dropped)
        if (i < n) {
          map.push(runStart);
          normalized += " ";
        }
      } else {
        map.push(origPos + i);
        normalized += ch;
        i++;
      }
    }
    // newline between lines is represented as a literal "\n" in normalized form
    if (li < lines.length - 1) {
      map.push(origPos + n); // offset of the "\n" in the original
      normalized += "\n";
    }
    origPos += n + 1; // +1 for the "\n" delimiter that split() removed
  }
  // Sentinel: end-of-normalized maps to one past the last consumed original char.
  map.push(content.length);
  return { normalized, map };
}

/**
 * Locate the span in `content` to replace for an edit of `oldString`, trying a
 * ladder of progressively fuzzier strategies (exact → whitespace-normalized →
 * line-trim anchored). Pure — no filesystem — so it can be unit-tested directly.
 *
 * Returns the original-file `{ start, end }` offsets and the matching strategy,
 * or `{ error }` when nothing matches uniquely (ambiguity is an error, never a
 * silent pick).
 */
export function locateEdit(content: string, oldString: string): LocateEditResult {
  // --- 1. Exact ---
  const exactCount = content.split(oldString).length - 1;
  if (exactCount === 1) {
    const start = content.indexOf(oldString);
    return { start, end: start + oldString.length, strategy: "exact" };
  }
  if (exactCount > 1) {
    return {
      error: `old_string occurs ${exactCount} times; it must be unique. Include more surrounding context (e.g. whole lines above/below) so it matches exactly one place.`,
    };
  }

  // --- 2. Whitespace-normalized ---
  const fileNorm = normalizeWithMap(content);
  // normalize each line, then join with newlines kept as structural anchors
  const normTarget = oldString.split("\n").map(normalizeLine).join("\n");
  if (normTarget.length > 0) {
    const occurrences: number[] = [];
    let idx = fileNorm.normalized.indexOf(normTarget);
    while (idx !== -1) {
      occurrences.push(idx);
      idx = fileNorm.normalized.indexOf(normTarget, idx + 1);
    }
    if (occurrences.length === 1) {
      const nStart = occurrences[0];
      const nEnd = nStart + normTarget.length;
      const start = fileNorm.map[nStart];
      const end = fileNorm.map[nEnd];
      const line = content.slice(0, start).split("\n").length;
      return { start, end, strategy: `whitespace-normalized match at line ${line}` };
    }
    if (occurrences.length > 1) {
      return {
        error: `old_string matches ${occurrences.length} places after normalizing whitespace; it is ambiguous. Add more surrounding context so it matches exactly one place.`,
      };
    }
  }

  // --- 3. Line-trim anchored ---
  const fileLines = content.split("\n");
  const targetLines = oldString.split("\n").map((l) => l.trim());
  // Drop trailing empty target lines that come from a trailing newline in oldString.
  while (targetLines.length > 1 && targetLines[targetLines.length - 1] === "") targetLines.pop();
  if (targetLines.length > 0) {
    const trimmedFile = fileLines.map((l) => l.trim());
    const runStarts: number[] = [];
    for (let i = 0; i + targetLines.length <= trimmedFile.length; i++) {
      let match = true;
      for (let j = 0; j < targetLines.length; j++) {
        if (trimmedFile[i + j] !== targetLines[j]) { match = false; break; }
      }
      if (match) runStarts.push(i);
    }
    if (runStarts.length === 1) {
      const i = runStarts[0];
      // start offset = sum of lengths of lines [0..i) plus their "\n" separators
      let start = 0;
      for (let k = 0; k < i; k++) start += fileLines[k].length + 1;
      let end = start;
      for (let k = 0; k < targetLines.length; k++) end += fileLines[i + k].length + 1;
      // We counted a trailing "\n" past the last matched line; drop it so the
      // replaced span ends at the line's end, not into the next line.
      end = Math.min(end - 1, content.length);
      return { start, end, strategy: `line-trim anchored match at line ${i + 1}` };
    }
    if (runStarts.length > 1) {
      return {
        error: `old_string matches ${runStarts.length} line runs after trimming indentation; it is ambiguous. Add more surrounding context so it matches exactly one place.`,
      };
    }
  }

  // --- 4. Nothing matched: clear error + a hint about the first differing line. ---
  const firstLine = oldString.split("\n").find((l) => l.trim().length > 0) ?? oldString;
  return {
    error:
      `old_string was not found (tried exact, whitespace-normalized, and line-trim matching). ` +
      `The file likely differs from what you expect — read it first, then copy the exact text to replace. ` +
      `First line that did not match: ${JSON.stringify(firstLine.trim().slice(0, 120))}`,
  };
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
    const path = resolveSessionPath(String(args.path ?? ""));
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

export const makeDirectoryTool: Tool = {
  definition: {
    name: "make_directory",
    description:
      "Create a directory (a folder), including any missing parent directories. Use this whenever you need to make a folder — NEVER create a directory by writing an empty file; that makes a file, not a folder.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative directory path to create" },
      },
      required: ["path"],
    },
  },
  async execute(args): Promise<ToolResult> {
    const path = resolveSessionPath(String(args.path ?? ""));
    try {
      const existing = await stat(path).catch(() => null);
      if (existing) {
        return existing.isDirectory()
          ? { success: true, data: `Directory already exists: ${path}` }
          : { success: false, data: "", error: `A file already exists at ${path} — remove it or choose another name.` };
      }
      await mkdir(path, { recursive: true });
      return { success: true, data: `Created directory ${path}` };
    } catch (err: unknown) {
      return { success: false, data: "", error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const writeFileTool: Tool = {
  definition: {
    name: "write_file",
    description:
      "Write content to a file, replacing it if it exists. Parent directories are created automatically, so you do NOT need to make the folder first — just write the file at its full path. (To create an empty folder, use make_directory.) Put real line breaks in content, not the literal two characters backslash-n.",
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
    const path = resolveSessionPath(String(args.path ?? ""));
    const content = restoreCollapsedNewlines(String(args.content ?? ""));
    const dir = dirname(path);
    try {
      await mkdir(dir, { recursive: true });
    } catch (err: unknown) {
      // A parent path component exists as a file, not a directory.
      const info = await stat(dir).catch(() => null);
      if (info && !info.isDirectory()) {
        return {
          success: false,
          data: "",
          error: `Cannot write ${path}: ${dir} exists as a file, not a directory. (To make a folder use make_directory — do not create a directory by writing an empty file.)`,
        };
      }
      return { success: false, data: "", error: err instanceof Error ? err.message : String(err) };
    }
    try {
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
    const path = resolveSessionPath(String(args.path ?? ""));
    const content = restoreCollapsedNewlines(String(args.content ?? ""));
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
      "Edit a file. PREFERRED: pass old_string (the exact existing text to change) and new_string (what to replace it with). old_string must match the file character-for-character and occur exactly once — include enough surrounding context (whole lines) to be unique. This is the reliable way to change code: you do NOT count line numbers, so you can't hit the wrong line. ALTERNATIVELY (only when you can't quote the text, e.g. pure insertion or deleting a span), use line mode: start_line and end_line (1-indexed, inclusive) with new_content; set end_line = start_line-1 to insert, empty new_content to delete. Returns a diff.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative path to the file" },
        old_string: { type: "string", description: "Exact existing text to replace (must occur exactly once). Preferred over line numbers." },
        new_string: { type: "string", description: "Replacement text for old_string (empty string deletes it)" },
        start_line: { type: "number", description: "Line mode only: 1-indexed first line to replace (inclusive)" },
        end_line: { type: "number", description: "Line mode only: 1-indexed last line to replace; use start_line-1 to insert" },
        new_content: { type: "string", description: "Line mode only: replacement text for the range (empty deletes it)" },
      },
      required: ["path"],
    },
  },
  async execute(args): Promise<ToolResult> {
    const path = resolveSessionPath(String(args.path ?? ""));
    let original: string;
    try {
      original = await readFile(path, "utf-8");
    } catch {
      return { success: false, data: "", error: `No such file: ${path}` };
    }

    const hasOldString = args.old_string !== undefined && args.old_string !== null;
    const hasLineRange = args.start_line !== undefined && args.start_line !== null;

    // --- Preferred: exact string replacement (no line counting) ---
    if (hasOldString) {
      const oldString = String(args.old_string);
      const newString = restoreCollapsedNewlines(String(args.new_string ?? ""));
      if (oldString === "") {
        return { success: false, data: "", error: "old_string must not be empty. To insert text, use line mode (end_line = start_line-1)." };
      }
      // Locate the span via the exact → whitespace-normalized → line-trim ladder.
      const located = locateEdit(original, oldString);
      if ("error" in located) {
        return { success: false, data: "", error: `${located.error} (in ${path})` };
      }
      const { start, end, strategy } = located;
      const removed = original.slice(start, end);
      const updated = original.slice(0, start) + newString + original.slice(end);
      try {
        await writeFile(path, updated, "utf-8");
      } catch (err: unknown) {
        return { success: false, data: "", error: err instanceof Error ? err.message : String(err) };
      }
      const diff = [
        `--- ${path} (before)`,
        `+++ ${path} (after)`,
        ...removed.split("\n").map((l) => `-${l}`),
        ...newString.split("\n").map((l) => `+${l}`),
      ].join("\n");
      // Exact matches keep the original (diff-only) success message; fuzzy matches
      // tell the model which strategy applied and where, so it can trust the edit.
      const data = strategy === "exact" ? diff : `Edited ${path} (${strategy})\n${diff}`;
      return { success: true, data };
    }

    if (!hasLineRange) {
      return {
        success: false,
        data: "",
        error: "Provide old_string + new_string (preferred), or start_line + end_line + new_content for line mode.",
      };
    }

    // --- Line mode: replace/insert/delete a line range ---
    const start = Number(args.start_line);
    const end = Number(args.end_line);
    const newContent = restoreCollapsedNewlines(String(args.new_content ?? ""));
    try {
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
    const path = resolveSessionPath(String(args.path ?? ""));
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
    const destination = resolveSessionPath(String(args.destination ?? ""));
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
    const cwd = args.cwd ? resolveSessionPath(String(args.cwd)) : getSessionCwd();
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
    const searchPath = resolveSessionPath(String(args.path ?? "."));
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
