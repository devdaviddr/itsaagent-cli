/**
 * Flatten the conversation into styled, wrapped lines so the message log can
 * window/scroll at the line level (reliable line-by-line scrollback, and live
 * streaming = appending lines). Pure — unit-testable.
 */
import type { Entry } from "../state/conversation.js";
import type { Theme } from "../theme.js";
import { resultLines, clampLines, moreMarker, collapsedSummary } from "../components/toolFormat.js";

export interface Line {
  text: string;
  color: string;
  bold?: boolean;
}

const MAX_TOOL_LINES = 20;

/** Hard-wrap text to width, preserving explicit newlines. */
export function wrapText(text: string, width: number): string[] {
  const w = width > 0 ? width : 80;
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    if (raw.length === 0) {
      out.push("");
      continue;
    }
    for (let i = 0; i < raw.length; i += w) out.push(raw.slice(i, i + w));
  }
  return out;
}

function entryLines(entry: Entry, width: number, theme: Theme): Line[] {
  const lines: Line[] = [];
  const push = (text: string, color: string, bold?: boolean): void => {
    lines.push({ text, color, bold });
  };

  switch (entry.kind) {
    case "user":
      wrapText(entry.text, width - 2).forEach((l, i) =>
        push((i === 0 ? "› " : "  ") + l, theme.user, theme.bold),
      );
      break;
    case "thought":
      wrapText(entry.text, width - 2).forEach((l, i) => push((i === 0 ? "● " : "  ") + l, theme.muted));
      break;
    case "answer":
      wrapText(entry.text, width).forEach((l) => push(l, theme.assistant));
      break;
    case "error":
      wrapText(entry.text, width - 2).forEach((l, i) => push((i === 0 ? "✗ " : "  ") + l, theme.error));
      break;
    case "notice":
      wrapText(entry.text, width).forEach((l) => push(l, theme.muted));
      break;
    case "tool": {
      const icon = entry.status === "running" ? "…" : entry.status === "success" ? "✓" : "✗";
      const argStr = JSON.stringify(entry.args ?? {}).replace(/\s+/g, " ");
      const head = `▸ ${entry.name} ${argStr} ${icon}`;
      push(head.length > width ? head.slice(0, width - 1) + "…" : head, theme.toolName);
      const body = resultLines(entry.result);
      if (entry.expanded) {
        const { shown, hidden } = clampLines(body, MAX_TOOL_LINES);
        shown.forEach((l) => wrapText("  " + l, width).forEach((w) => push(w, theme.muted)));
        if (hidden > 0) push("  " + moreMarker(hidden), theme.muted);
      } else {
        const summary = collapsedSummary(entry.result);
        if (summary) {
          const extra = Math.max(0, body.length - 1);
          const line = "  " + summary + (extra > 0 ? `   (+${extra} more)` : "");
          push(line.length > width ? line.slice(0, width - 1) + "…" : line, theme.muted);
        }
      }
      break;
    }
  }
  return lines;
}

/**
 * Flatten all entries (plus any live streaming text) to styled lines. A blank
 * spacer line follows answers/errors for readability.
 */
export function flattenConversation(
  entries: Entry[],
  width: number,
  theme: Theme,
  live = "",
): Line[] {
  const lines: Line[] = [];
  for (const entry of entries) {
    lines.push(...entryLines(entry, width, theme));
    if (entry.kind === "answer" || entry.kind === "error") lines.push({ text: "", color: theme.muted });
  }
  if (live) {
    for (const l of wrapText(live, width)) lines.push({ text: l, color: theme.assistant });
  }
  return lines;
}

export interface LineWindow {
  lines: Line[];
  hiddenAbove: number;
  hiddenBelow: number;
}

/**
 * The slice of lines visible in a `rows`-tall viewport, anchored to the tail
 * minus `scrollOffset` lines (0 = following the latest). Clamps so you can't
 * scroll past either end.
 */
export function windowLines(all: Line[], rows: number, scrollOffset: number): LineWindow {
  const total = all.length;
  const r = Math.max(1, rows);
  const maxScroll = Math.max(0, total - r);
  const offset = Math.min(Math.max(0, scrollOffset), maxScroll);
  const bottom = total - offset;
  const top = Math.max(0, bottom - r);
  return {
    lines: all.slice(top, bottom),
    hiddenAbove: top,
    hiddenBelow: total - bottom,
  };
}
