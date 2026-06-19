/**
 * Pure formatting helpers for tool blocks: result line extraction, display
 * clamping with an explicit "more lines" marker, and the collapsed one-line
 * summary. Kept pure so the truncation math is unit-testable.
 */
import type { ToolResult } from "../../../types.js";

/** The body lines of a tool result (data on success, error otherwise). */
export function resultLines(result?: ToolResult): string[] {
  if (!result) return [];
  const body = result.success ? result.data : result.error || result.data;
  if (!body) return [];
  return body.split("\n");
}

export interface ClampedLines {
  shown: string[];
  hidden: number;
}

/** Show at most `max` lines; report how many were hidden so a marker can be drawn. */
export function clampLines(lines: string[], max: number): ClampedLines {
  if (max <= 0) return { shown: [], hidden: lines.length };
  if (lines.length <= max) return { shown: lines, hidden: 0 };
  return { shown: lines.slice(0, max), hidden: lines.length - max };
}

/** Marker text for hidden lines, or empty when nothing is hidden. */
export function moreMarker(hidden: number): string {
  return hidden > 0 ? `… (${hidden} more line${hidden === 1 ? "" : "s"} — Enter to expand)` : "";
}

/** First non-empty line of a result, for the collapsed summary. */
export function collapsedSummary(result?: ToolResult): string {
  const first = resultLines(result).find((l) => l.trim().length > 0);
  return first ?? "";
}
