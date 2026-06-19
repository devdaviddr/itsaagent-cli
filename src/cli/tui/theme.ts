/**
 * TUI theme: a single semantic palette every component reads from, so there are
 * no raw colour literals scattered across the Ink tree. Colours are Ink colour
 * strings (named colours or hex). Pure data — safe to import from non-TTY paths.
 */
import { CTX_MID_THRESHOLD, CTX_HIGH_THRESHOLD } from "../contextBar.js";

export interface Theme {
  /** Theme identifier, matches the key in {@link THEMES}. */
  name: string;
  user: string;
  assistant: string;
  thought: string;
  toolName: string;
  success: string;
  error: string;
  warning: string;
  muted: string;
  accent: string;
  border: string;
  ctxLow: string;
  ctxMid: string;
  ctxHigh: string;
}

const DEFAULT_THEME: Theme = {
  name: "default",
  user: "cyan",
  assistant: "white",
  thought: "magenta",
  toolName: "blue",
  success: "green",
  error: "red",
  warning: "yellow",
  muted: "gray",
  accent: "cyan",
  border: "gray",
  ctxLow: "green",
  ctxMid: "yellow",
  ctxHigh: "red",
};

const MONO_THEME: Theme = {
  name: "mono",
  user: "white",
  assistant: "white",
  thought: "gray",
  toolName: "white",
  success: "white",
  error: "white",
  warning: "white",
  muted: "gray",
  accent: "white",
  border: "gray",
  ctxLow: "gray",
  ctxMid: "white",
  ctxHigh: "white",
};

export const THEMES: Record<string, Theme> = {
  default: DEFAULT_THEME,
  mono: MONO_THEME,
};

export const DEFAULT_THEME_NAME = "default";

/** Resolve a theme by name, falling back to the default for unknown/unset names. */
export function resolveTheme(name?: string): Theme {
  if (name && Object.prototype.hasOwnProperty.call(THEMES, name)) return THEMES[name];
  return DEFAULT_THEME;
}

/** Names of all built-in themes, default first. */
export function themeNames(): string[] {
  return Object.keys(THEMES);
}

/** Context-bar colour for a usage ratio, using the same thresholds as {@link usageLevel}. */
export function ctxColor(ratio: number, theme: Theme): string {
  if (ratio > CTX_HIGH_THRESHOLD) return theme.ctxHigh;
  if (ratio >= CTX_MID_THRESHOLD) return theme.ctxMid;
  return theme.ctxLow;
}
