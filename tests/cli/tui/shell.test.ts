import { describe, expect, it } from "vitest";
import { wrappedLines, entryHeight, windowEntries } from "../../../src/cli/tui/layout/viewport.js";
import { headerText, statusHint } from "../../../src/cli/tui/layout/chrome.js";
import { selectRenderMode } from "../../../src/cli/output.js";
import {
  conversationReducer,
  initialConversation,
  type ToolEntry,
} from "../../../src/cli/tui/state/conversation.js";

describe("viewport — line estimation", () => {
  it("wraps long lines and counts newlines", () => {
    expect(wrappedLines("hello", 80)).toBe(1);
    expect(wrappedLines("a".repeat(160), 80)).toBe(2);
    expect(wrappedLines("a\nb\nc", 80)).toBe(3);
  });

  it("entryHeight collapses tools by default and expands on demand", () => {
    const base: ToolEntry = {
      id: 1,
      kind: "tool",
      stepIndex: 1,
      name: "read_file",
      args: { path: "x.ts" },
      status: "success",
      result: { success: true, data: "line1\nline2\nline3" },
      expanded: false,
    };
    expect(entryHeight(base, 80)).toBe(1);
    expect(entryHeight({ ...base, expanded: true }, 80)).toBeGreaterThan(1);
  });
});

describe("viewport — windowing", () => {
  it("shows everything when it fits, with nothing hidden", () => {
    const win = windowEntries([1, 1, 1], 10, 0);
    expect(win.startIndex).toBe(0);
    expect(win.endIndex).toBe(3);
    expect(win.hiddenAbove).toBe(0);
    expect(win.hiddenBelow).toBe(0);
  });

  it("anchors to the tail when content overflows", () => {
    const heights = [1, 1, 1, 1, 1, 1, 1, 1]; // 8 lines
    const win = windowEntries(heights, 3, 0);
    expect(win.hiddenAbove).toBeGreaterThan(0);
    expect(win.hiddenBelow).toBe(0);
    expect(win.endIndex).toBe(8);
  });

  it("scrolling up reveals earlier entries and hides later ones", () => {
    const heights = [1, 1, 1, 1, 1, 1, 1, 1];
    const win = windowEntries(heights, 3, 4);
    expect(win.hiddenAbove).toBeLessThan(windowEntries(heights, 3, 0).hiddenAbove);
    expect(win.hiddenBelow).toBeGreaterThan(0);
  });

  it("clamps the offset so it cannot scroll past the top", () => {
    const heights = [1, 1, 1, 1];
    const win = windowEntries(heights, 2, 999);
    expect(win.startIndex).toBe(0);
    expect(win.hiddenAbove).toBe(0);
  });
});

describe("chrome text", () => {
  it("formats the header", () => {
    expect(headerText("build", "qwen2.5-coder")).toBe("ItsAAgent · build · qwen2.5-coder");
  });

  it("selects a hint per mode", () => {
    expect(statusHint("running")).toContain("Esc to cancel");
    expect(statusHint("scrolled")).toContain("latest");
    expect(statusHint("idle")).toContain("/help");
    expect(statusHint("error")).toContain("continue");
  });
});

describe("render-mode routing", () => {
  it("non-TTY always falls back to the plain renderer", () => {
    expect(selectRenderMode({ isTTY: false, interactive: true })).toBe("plain");
    expect(selectRenderMode({ isTTY: false, interactive: false })).toBe("plain");
  });

  it("a TTY uses the persistent TUI only when opted in", () => {
    expect(selectRenderMode({ isTTY: true, interactive: true })).toBe("interactive");
    expect(selectRenderMode({ isTTY: true, interactive: false })).toBe("oneshot");
  });
});

describe("turn submission preserves prior turns", () => {
  it("a second user message appends without clearing the log", () => {
    let state = initialConversation();
    for (const action of [
      { type: "user" as const, text: "first" },
      { type: "answer" as const, text: "ok" },
      { type: "user" as const, text: "second" },
    ]) {
      state = conversationReducer(state, action);
    }
    const userTexts = state.entries.filter((e) => e.kind === "user").map((e) => (e as { text: string }).text);
    expect(userTexts).toEqual(["first", "second"]);
    expect(state.entries).toHaveLength(3);
  });
});
