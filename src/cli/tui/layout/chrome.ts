/**
 * Pure text helpers for the TUI chrome (header + status line). Kept separate from
 * the Ink components so the formatting is unit-testable.
 */

/** Header label, e.g. "ItsAAgent · build · qwen2.5-coder". */
export function headerText(agent: string, model: string): string {
  return `ItsAAgent · ${agent} · ${model}`;
}

export type TuiMode = "idle" | "running" | "scrolled" | "error";

/** Contextual hint shown on the status line for the current mode. */
export function statusHint(mode: TuiMode): string {
  switch (mode) {
    case "running":
      return "● running… Esc to cancel";
    case "scrolled":
      return "↑ scrolled — End to return to latest";
    case "error":
      return "✗ error — type to continue";
    case "idle":
    default:
      return "/help · ↵ send · Ctrl+C quit";
  }
}
