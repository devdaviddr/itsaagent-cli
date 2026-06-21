import type { Message } from "../types.js";

/** How aggressively to compress context as it fills. */
export type CompactionMode = "off" | "structured" | "summarize";

/**
 * Deterministic structured compaction. Tool results (file contents, command
 * output) are the bulk of a long session, so we shrink the OLD ones without
 * dropping the conversation:
 *  - a read_file result whose path is later re-read or written/edited is
 *    superseded → replaced with a one-line stub,
 *  - other old tool results are truncated to their header + first line.
 * The system prompt, original task, notices, and the most recent `recentWindow`
 * messages are kept verbatim. No LLM call; preserves order and meaning.
 */
export interface CompactionOptions {
  /** Keep this many of the newest messages fully intact. */
  recentWindow: number;
}

const DEFAULTS: CompactionOptions = { recentWindow: 6 };
/** Old tool-result payloads are capped to this many characters. */
const DATA_CAP = 600;

interface ParsedToolResult {
  name: string;
  path?: string;
  /** Index of the first newline (start of the data payload), or -1. */
  firstNl: number;
}

/** Parse a "[TOOL RESULT: name — OK] {args}\n<data>" message, or null if not one. */
function parseToolResult(content: string): ParsedToolResult | null {
  const m = content.match(/^\[TOOL RESULT: (\w+) — (?:OK|FAILED)\]\s*(\{.*?\})?/);
  if (!m) return null;
  let path: string | undefined;
  if (m[2]) {
    try {
      const args = JSON.parse(m[2]) as { path?: unknown; destination?: unknown };
      if (typeof args.path === "string") path = args.path;
      else if (typeof args.destination === "string") path = args.destination;
    } catch {
      /* ignore unparyable args */
    }
  }
  return { name: m[1], path, firstNl: content.indexOf("\n") };
}

/** First line of a tool result (the header), for the truncated stub. */
function headerLine(content: string): string {
  const nl = content.indexOf("\n");
  return nl === -1 ? content : content.slice(0, nl);
}

/**
 * Compact `messages`. `pinned` marks indices that must be kept verbatim
 * (system / original task / notice). Returns the new list and whether anything
 * changed. Pure — does not mutate the input.
 */
export function compactMessages(
  messages: Message[],
  pinned: (index: number) => boolean,
  opts: Partial<CompactionOptions> = {},
): { messages: Message[]; changed: boolean } {
  const { recentWindow } = { ...DEFAULTS, ...opts };
  const lastIndex = messages.length - 1;
  const recentStart = Math.max(0, messages.length - recentWindow);

  // Which read_file paths are superseded later (re-read, or written/edited)?
  // A read at index i is superseded if any LATER tool result touches the same path.
  const latestTouch = new Map<string, number>();
  messages.forEach((m, i) => {
    const tr = parseToolResult(m.content);
    if (tr?.path) latestTouch.set(tr.path, i);
  });

  let changed = false;
  const out = messages.map((m, i) => {
    if (pinned(i) || i >= recentStart || i === lastIndex) return m; // keep verbatim
    const tr = parseToolResult(m.content);
    if (!tr) return m; // only compact tool results
    // Superseded read → stub.
    if (tr.name === "read_file" && tr.path && (latestTouch.get(tr.path) ?? -1) > i) {
      changed = true;
      return { ...m, content: `[TOOL RESULT: read_file ${tr.path} — superseded by a later read/edit, omitted to save context]` };
    }
    // Never truncate FAILED results — the error message is diagnostic context the model needs.
    if (m.content.includes('— FAILED]')) return m;
    // Otherwise cap the data payload (handles single huge lines and long dumps).
    if (tr.firstNl !== -1) {
      const header = headerLine(m.content);
      const data = m.content.slice(tr.firstNl + 1);
      if (data.length > DATA_CAP) {
        const truncated = `${header}\n${data.slice(0, DATA_CAP)}\n…[trimmed for context]`;
        if (truncated.length < m.content.length) {
          changed = true;
          return { ...m, content: truncated };
        }
      }
    }
    return m;
  });

  return { messages: out, changed };
}
