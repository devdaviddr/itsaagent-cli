import { describe, expect, it } from "vitest";
import { resolveTheme, themeNames, ctxColor, THEMES, DEFAULT_THEME_NAME } from "../../../src/cli/tui/theme.js";
import { usageLevel, CTX_MID_THRESHOLD, CTX_HIGH_THRESHOLD } from "../../../src/cli/contextBar.js";

describe("theme resolver", () => {
  it("resolves a known theme by name", () => {
    expect(resolveTheme("mono").name).toBe("mono");
    expect(resolveTheme("default").name).toBe("default");
  });

  it("falls back to default for unknown or unset names", () => {
    expect(resolveTheme("does-not-exist").name).toBe(DEFAULT_THEME_NAME);
    expect(resolveTheme(undefined).name).toBe(DEFAULT_THEME_NAME);
    expect(resolveTheme("").name).toBe(DEFAULT_THEME_NAME);
  });

  it("ships several built-in themes, default first", () => {
    const names = themeNames();
    expect(names.length).toBeGreaterThanOrEqual(5);
    expect(names[0]).toBe(DEFAULT_THEME_NAME);
    expect(names).toEqual(expect.arrayContaining(["mono", "dracula", "nord", "gruvbox"]));
  });

  it("built-in colour themes carry a background", () => {
    expect(resolveTheme("dracula").background).toBeTruthy();
    expect(resolveTheme("nord").panel).toBeTruthy();
  });
});

describe("custom theme overrides", () => {
  it("builds a custom theme from the default + user overrides", () => {
    const t = resolveTheme("custom", { accent: "#ff8800", background: "#101010", bold: false });
    expect(t.name).toBe("custom");
    expect(t.accent).toBe("#ff8800");
    expect(t.background).toBe("#101010");
    expect(t.bold).toBe(false);
    // unspecified fields fall back to the default palette
    expect(t.error).toBe(resolveTheme("default").error);
  });

  it("ignores 'custom' when no overrides are provided", () => {
    expect(resolveTheme("custom").name).toBe(DEFAULT_THEME_NAME);
  });

  it("includes 'custom' in the theme list only when overrides exist", () => {
    expect(themeNames(false)).not.toContain("custom");
    expect(themeNames(true)).toContain("custom");
  });
});

describe("context thresholds are the single source", () => {
  it("ctxColor uses the same boundaries as usageLevel", () => {
    const theme = THEMES.default;
    // Below mid → low band
    expect(usageLevel(CTX_MID_THRESHOLD - 1)).toBe("low");
    expect(ctxColor(CTX_MID_THRESHOLD - 1, theme)).toBe(theme.ctxLow);
    // At mid → mid band
    expect(usageLevel(CTX_MID_THRESHOLD)).toBe("mid");
    expect(ctxColor(CTX_MID_THRESHOLD, theme)).toBe(theme.ctxMid);
    // Above high → high band
    expect(usageLevel(CTX_HIGH_THRESHOLD + 1)).toBe("high");
    expect(ctxColor(CTX_HIGH_THRESHOLD + 1, theme)).toBe(theme.ctxHigh);
  });
});
