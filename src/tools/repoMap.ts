import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname, dirname } from "node:path";
import type { Tool, ToolResult } from "../types.js";
import { getSessionCwd, resolveSessionPath } from "./session.js";

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next", "coverage", "vendor",
  "target", ".venv", "venv", "__pycache__", ".cache", ".turbo", ".idea", ".vscode",
]);
const CODE_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java",
  ".rb", ".php", ".c", ".cc", ".cpp", ".h", ".hpp", ".cs", ".swift", ".kt", ".scala", ".sh",
]);

const MAX_FILES = 600;
const MAX_SYMBOLS_PER_FILE = 12;
const MAX_OUTPUT = 6000;
const MAX_FILE_BYTES = 200 * 1024;

/** Top-level symbol patterns across common languages (name in group 1). */
const SYMBOL_PATTERNS: RegExp[] = [
  /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/, // ts/js export fn
  /^\s*export\s+(?:abstract\s+)?class\s+(\w+)/, // ts/js export class
  /^\s*export\s+(?:const|let|var)\s+(\w+)/, // ts/js export const
  /^\s*export\s+(?:interface|type|enum)\s+(\w+)/, // ts/js types
  /^\s*(?:async\s+)?function\s+(\w+)/, // js fn
  /^\s*class\s+(\w+)/, // class (ts/js/py)
  /^\s*(?:async\s+)?def\s+(\w+)/, // python def
  /^func\s+(?:\([^)]*\)\s*)?(\w+)/, // go func / method
  /^type\s+(\w+)/, // go type
  /^\s*(?:pub\s+)?fn\s+(\w+)/, // rust fn
  /^\s*(?:pub\s+)?(?:struct|enum|trait)\s+(\w+)/, // rust types
];

function extractSymbols(content: string): string[] {
  const names = new Set<string>();
  for (const line of content.split("\n")) {
    for (const re of SYMBOL_PATTERNS) {
      const m = line.match(re);
      if (m && m[1]) {
        names.add(m[1]);
        break;
      }
    }
    if (names.size >= MAX_SYMBOLS_PER_FILE) break;
  }
  return [...names];
}

interface FileEntry {
  rel: string;
  symbols: string[];
}

function walk(root: string): { files: FileEntry[]; scanned: number; truncated: boolean } {
  const files: FileEntry[] = [];
  let scanned = 0;
  let truncated = false;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name.startsWith(".") && name !== ".github") continue;
      const abs = join(dir, name);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!IGNORE_DIRS.has(name)) stack.push(abs);
        continue;
      }
      if (!CODE_EXT.has(extname(name)) || st.size > MAX_FILE_BYTES) continue;
      if (scanned >= MAX_FILES) {
        truncated = true;
        continue;
      }
      scanned++;
      let symbols: string[] = [];
      try {
        symbols = extractSymbols(readFileSync(abs, "utf-8"));
      } catch {
        /* ignore unreadable */
      }
      files.push({ rel: relative(root, abs), symbols });
    }
  }
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return { files, scanned, truncated };
}

/** Build a compact directory-grouped map of files and their top-level symbols. */
export function buildRepoMap(root: string): { text: string; fileCount: number } {
  const { files, truncated } = walk(root);
  const byDir = new Map<string, FileEntry[]>();
  for (const f of files) {
    const d = dirname(f.rel);
    (byDir.get(d) ?? byDir.set(d, []).get(d)!).push(f);
  }
  const out: string[] = [`Repository map: ${root}`, `${files.length} code file(s)${truncated ? " (capped)" : ""}`, ""];
  let chars = out.join("\n").length;
  let cut = false;
  for (const dir of [...byDir.keys()].sort()) {
    const header = dir === "." ? "(root)" : `${dir}/`;
    const block: string[] = [header];
    for (const f of byDir.get(dir)!) {
      const base = f.rel.split("/").pop()!;
      block.push(`  ${base}${f.symbols.length ? `: ${f.symbols.join(", ")}` : ""}`);
    }
    const blockText = block.join("\n");
    if (chars + blockText.length + 1 > MAX_OUTPUT) {
      cut = true;
      break;
    }
    out.push(blockText);
    chars += blockText.length + 1;
  }
  if (cut) out.push("…[map truncated — narrow with the path argument]");
  return { text: out.join("\n"), fileCount: files.length };
}

/**
 * `repo_map` — a structural index of the codebase: every code file grouped by
 * directory with its top-level functions/classes/exports. Use it to orient
 * before answering questions about the codebase or before editing, then grep/
 * read the relevant files. Read-only.
 */
export const repoMapTool: Tool = {
  definition: {
    name: "repo_map",
    description:
      "Get a structural map of the codebase — files grouped by directory, each with its top-level functions/classes/exports. Use this to orient before answering questions about the project or navigating to the right file. Pass `path` to scope to a subdirectory.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Optional subdirectory to map (default: the whole working directory)" },
      },
      required: [],
    },
  },
  async execute(args): Promise<ToolResult> {
    const root = args.path ? resolveSessionPath(String(args.path)) : getSessionCwd();
    try {
      const info = statSync(root);
      if (!info.isDirectory()) return { success: false, data: "", error: `Not a directory: ${root}` };
    } catch {
      return { success: false, data: "", error: `No such directory: ${root}` };
    }
    const { text, fileCount } = buildRepoMap(root);
    if (fileCount === 0) return { success: true, data: `No code files found under ${root}.` };
    return { success: true, data: text };
  },
};
