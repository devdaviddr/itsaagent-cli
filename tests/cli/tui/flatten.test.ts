import { describe, expect, it } from "vitest";
import { wrapText, flattenConversation, windowLines, markdownLines } from "../../../src/cli/tui/layout/flatten.js";
import { conversationReducer, initialConversation, type ConvAction } from "../../../src/cli/tui/state/conversation.js";
import { resolveTheme } from "../../../src/cli/tui/theme.js";

const theme = resolveTheme("default");

function build(actions: ConvAction[]) {
  let s = initialConversation();
  for (const a of actions) s = conversationReducer(s, a);
  return s;
}

describe("wrapText", () => {
  it("hard-wraps to width and preserves newlines", () => {
    expect(wrapText("hello", 80)).toEqual(["hello"]);
    expect(wrapText("aaaaaa", 3)).toEqual(["aaa", "aaa"]);
    expect(wrapText("a\nb", 80)).toEqual(["a", "b"]);
  });
});

describe("flattenConversation", () => {
  it("turns entries into styled lines, wrapping long answers", () => {
    const s = build([
      { type: "user", text: "hi" },
      { type: "answer", text: "x".repeat(50) },
    ]);
    const lines = flattenConversation(s.entries, 20, theme);
    // user line + 3 wrapped answer lines (50/20) + 1 spacer
    expect(lines[0].text).toBe("› hi");
    const answerLines = lines.filter((l) => l.text.startsWith("x"));
    expect(answerLines.length).toBe(3);
  });

  it("appends live streaming text as lines", () => {
    const s = build([{ type: "user", text: "go" }]);
    const lines = flattenConversation(s.entries, 80, theme, "streaming answer so far");
    expect(lines.some((l) => l.text.includes("streaming answer so far"))).toBe(true);
  });
});

describe("windowLines — line-level scrolling", () => {
  const lines = Array.from({ length: 20 }, (_, i) => ({ text: `L${i}`, color: "white" }));

  it("follows the tail at offset 0", () => {
    const w = windowLines(lines, 5, 0);
    expect(w.lines.map((l) => l.text)).toEqual(["L15", "L16", "L17", "L18", "L19"]);
    expect(w.hiddenBelow).toBe(0);
    expect(w.hiddenAbove).toBe(15);
  });

  it("scrolls up by line offset", () => {
    const w = windowLines(lines, 5, 3);
    expect(w.lines.map((l) => l.text)).toEqual(["L12", "L13", "L14", "L15", "L16"]);
    expect(w.hiddenBelow).toBe(3);
  });

  it("clamps so it cannot scroll past the top", () => {
    const w = windowLines(lines, 5, 999);
    expect(w.lines.map((l) => l.text)).toEqual(["L0", "L1", "L2", "L3", "L4"]);
    expect(w.hiddenAbove).toBe(0);
  });

  it("shows everything when it fits", () => {
    const w = windowLines(lines.slice(0, 3), 10, 0);
    expect(w.lines).toHaveLength(3);
    expect(w.hiddenAbove).toBe(0);
  });
});

describe("markdownLines styling", () => {
  it("colours code fences, headings, and prose distinctly", () => {
    const md = "# Title\nsome prose\n```js\ncode();\n```";
    const out = markdownLines(md, 80, theme);
    const heading = out.find((l) => l.text === "Title");
    const code = out.find((l) => l.text === "code();");
    const prose = out.find((l) => l.text === "some prose");
    expect(heading?.color).toBe(theme.accent);
    expect(heading?.bold).toBe(theme.bold);
    expect(code?.color).toBe(theme.toolName);
    expect(prose?.color).toBe(theme.assistant);
  });
});
