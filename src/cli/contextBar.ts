/** Pure helpers for rendering the context-usage indicator. Shared by the TUI and plain output. */

export type UsageLevel = "low" | "mid" | "high";

/**
 * Context-usage thresholds (percent). Single source of truth — the context bar,
 * header, and theme colour mapping all derive their boundaries from these.
 */
export const CTX_MID_THRESHOLD = 60;
export const CTX_HIGH_THRESHOLD = 80;

/** Threshold mapping: <60% low, 60–80% mid, >80% high. */
export function usageLevel(ratio: number): UsageLevel {
  if (ratio > CTX_HIGH_THRESHOLD) return "high";
  if (ratio >= CTX_MID_THRESHOLD) return "mid";
  return "low";
}

/** A fixed-width bar of filled/empty blocks for the given ratio (0–100). */
export function buildBar(ratio: number, width = 16): string {
  const clamped = Math.max(0, Math.min(100, ratio));
  const filled = Math.round((clamped / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

/** "8,432 / 24,576  34%" */
export function formatUsage(used: number, max: number, ratio: number): string {
  return `${used.toLocaleString("en-US")} / ${max.toLocaleString("en-US")}  ${ratio}%`;
}

/** Full single-line indicator, e.g. "ctx [████░░░░] 8,432 / 24,576 34%" (no colour). */
export function contextLine(used: number, max: number, ratio: number): string {
  return `ctx  [${buildBar(ratio)}]  ${formatUsage(used, max, ratio)}`;
}
