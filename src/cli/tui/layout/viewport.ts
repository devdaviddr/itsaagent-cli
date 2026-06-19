/**
 * Pure viewport math for the message log: estimate entry heights and pick the
 * slice of entries that fits the visible region, anchored to the tail minus the
 * current scroll offset. Kept pure so the scroll behaviour is unit-testable
 * without rendering Ink.
 */
import type { Entry } from "../state/conversation.js";

/** Number of rows a string occupies when wrapped to `width` columns. */
export function wrappedLines(text: string, width: number): number {
  const w = width > 0 ? width : 80;
  return text
    .split("\n")
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.length / w)), 0);
}

/** Estimated rendered height (rows) of an entry at the given content width. */
export function entryHeight(entry: Entry, width: number): number {
  switch (entry.kind) {
    case "user":
      return wrappedLines(entry.text, width);
    case "thought":
      return wrappedLines(entry.text, width);
    case "answer":
      return wrappedLines(entry.text, width);
    case "error":
      return wrappedLines(entry.text, width);
    case "notice":
      return wrappedLines(entry.text, width);
    case "tool": {
      const header = 1;
      if (!entry.expanded) return header;
      const argLines = wrappedLines(JSON.stringify(entry.args ?? {}), width);
      const body = entry.result ? entry.result.data || entry.result.error || "" : "";
      return header + argLines + wrappedLines(body, width);
    }
  }
}

export interface LogWindow {
  /** First visible entry index (inclusive). */
  startIndex: number;
  /** Last visible entry index (exclusive). */
  endIndex: number;
  /** Entries hidden above the window. */
  hiddenAbove: number;
  /** Entries hidden below the window. */
  hiddenBelow: number;
}

/**
 * Choose the entry slice covering the visible rows. `scrollOffset` is measured
 * in lines from the tail (0 = following the latest output) and is clamped so the
 * window can never scroll past the top.
 */
export function windowEntries(
  heights: number[],
  viewportRows: number,
  scrollOffset: number,
): LogWindow {
  const total = heights.length;
  if (total === 0) return { startIndex: 0, endIndex: 0, hiddenAbove: 0, hiddenBelow: 0 };

  const rows = Math.max(1, viewportRows);
  const totalHeight = heights.reduce((a, b) => a + b, 0);
  const maxOffset = Math.max(0, totalHeight - rows);
  const offset = Math.min(Math.max(0, scrollOffset), maxOffset);

  const bottomLine = totalHeight - offset; // exclusive
  const topLine = Math.max(0, bottomLine - rows); // inclusive

  // Cumulative start line of each entry.
  const cum: number[] = [];
  let acc = 0;
  for (let i = 0; i < total; i++) {
    cum.push(acc);
    acc += heights[i];
  }

  let startIndex = 0;
  for (let i = 0; i < total; i++) {
    if (cum[i] + heights[i] > topLine) {
      startIndex = i;
      break;
    }
  }

  let endIndex = total;
  for (let i = total - 1; i >= 0; i--) {
    if (cum[i] < bottomLine) {
      endIndex = i + 1;
      break;
    }
  }

  return {
    startIndex,
    endIndex,
    hiddenAbove: startIndex,
    hiddenBelow: total - endIndex,
  };
}
