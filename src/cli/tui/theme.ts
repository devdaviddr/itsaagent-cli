/**
 * TUI theme: a single semantic palette every component reads from. Colours are
 * tuir colour strings (named colours or hex). `background`/`panel` are optional
 * fills; `bold` toggles emphasis weight. Pure data — safe to import anywhere.
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
  /** App background fill (optional; omit to use the terminal's own background). */
  background?: string;
  /** Modal/panel background fill (optional). */
  panel?: string;
  /** Use bold weight for emphasis (titles, logo, selected rows, names). */
  bold: boolean;
}

/** The fields a user may override in a custom theme (everything except the name). */
export type ThemeOverrides = Partial<Omit<Theme, "name">>;

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
  bold: true,
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
  bold: false,
};

const DRACULA_THEME: Theme = {
  name: "dracula",
  user: "#8be9fd",
  assistant: "#f8f8f2",
  thought: "#ff79c6",
  toolName: "#50fa7b",
  success: "#50fa7b",
  error: "#ff5555",
  warning: "#f1fa8c",
  muted: "#6272a4",
  accent: "#bd93f9",
  border: "#6272a4",
  ctxLow: "#50fa7b",
  ctxMid: "#f1fa8c",
  ctxHigh: "#ff5555",
  background: "#282a36",
  panel: "#44475a",
  bold: true,
};

const NORD_THEME: Theme = {
  name: "nord",
  user: "#81a1c1",
  assistant: "#eceff4",
  thought: "#b48ead",
  toolName: "#8fbcbb",
  success: "#a3be8c",
  error: "#bf616a",
  warning: "#ebcb8b",
  muted: "#4c566a",
  accent: "#88c0d0",
  border: "#4c566a",
  ctxLow: "#a3be8c",
  ctxMid: "#ebcb8b",
  ctxHigh: "#bf616a",
  background: "#2e3440",
  panel: "#3b4252",
  bold: true,
};

const GRUVBOX_THEME: Theme = {
  name: "gruvbox",
  user: "#83a598",
  assistant: "#ebdbb2",
  thought: "#d3869b",
  toolName: "#b8bb26",
  success: "#b8bb26",
  error: "#fb4934",
  warning: "#fe8019",
  muted: "#928374",
  accent: "#fabd2f",
  border: "#504945",
  ctxLow: "#b8bb26",
  ctxMid: "#fabd2f",
  ctxHigh: "#fb4934",
  background: "#282828",
  panel: "#3c3836",
  bold: true,
};

export const THEMES: Record<string, Theme> = {
  default: DEFAULT_THEME,
  mono: MONO_THEME,
  dracula: DRACULA_THEME,
  nord: NORD_THEME,
  gruvbox: GRUVBOX_THEME,
};

export const DEFAULT_THEME_NAME = "default";
export const CUSTOM_THEME_NAME = "custom";

/**
 * Resolve a theme by name. When `overrides` is supplied, a "custom" theme built
 * from the default palette + the user's overrides is available under that name.
 * Unknown/unset names fall back to the default.
 */
export function resolveTheme(name?: string, overrides?: ThemeOverrides): Theme {
  if (name === CUSTOM_THEME_NAME && overrides) {
    return { ...DEFAULT_THEME, ...overrides, name: CUSTOM_THEME_NAME };
  }
  if (name && Object.prototype.hasOwnProperty.call(THEMES, name)) return THEMES[name];
  return DEFAULT_THEME;
}

/** Names of all selectable themes (built-ins, plus "custom" when defined). */
export function themeNames(hasCustom = false): string[] {
  const names = Object.keys(THEMES);
  return hasCustom ? [...names, CUSTOM_THEME_NAME] : names;
}

/** Context-bar colour for a usage ratio, using the same thresholds as usageLevel. */
export function ctxColor(ratio: number, theme: Theme): string {
  if (ratio > CTX_HIGH_THRESHOLD) return theme.ctxHigh;
  if (ratio >= CTX_MID_THRESHOLD) return theme.ctxMid;
  return theme.ctxLow;
}
