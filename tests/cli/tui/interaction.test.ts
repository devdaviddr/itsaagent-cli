import { describe, expect, it } from "vitest";
import {
  resultLines,
  clampLines,
  moreMarker,
  collapsedSummary,
} from "../../../src/cli/tui/components/toolFormat.js";
import { parseChatInput, matchCommands, COMMANDS } from "../../../src/cli/chatCommands.js";
import type { ToolResult } from "../../../src/types.js";

const multi: ToolResult = { success: true, data: "first\nsecond\nthird\nfourth" };
const errored: ToolResult = { success: false, data: "", error: "it broke\nline two" };

describe("tool formatting", () => {
  it("extracts result body lines (data on success, error otherwise)", () => {
    expect(resultLines(multi)).toEqual(["first", "second", "third", "fourth"]);
    expect(resultLines(errored)).toEqual(["it broke", "line two"]);
    expect(resultLines(undefined)).toEqual([]);
  });

  it("clamps to a max and reports the hidden count", () => {
    const lines = ["a", "b", "c", "d", "e"];
    expect(clampLines(lines, 10)).toEqual({ shown: lines, hidden: 0 });
    expect(clampLines(lines, 2)).toEqual({ shown: ["a", "b"], hidden: 3 });
    expect(clampLines(lines, 0)).toEqual({ shown: [], hidden: 5 });
  });

  it("renders a marker only when lines are hidden, with correct pluralisation", () => {
    expect(moreMarker(0)).toBe("");
    expect(moreMarker(1)).toBe("… (1 more line — Enter to expand)");
    expect(moreMarker(3)).toBe("… (3 more lines — Enter to expand)");
  });

  it("summarises with the first non-empty line", () => {
    expect(collapsedSummary({ success: true, data: "\n\n  hello\nworld" })).toBe("  hello");
    expect(collapsedSummary(undefined)).toBe("");
  });
});

describe("slash command parsing — new commands", () => {
  it("parses /theme, /models, /tools", () => {
    expect(parseChatInput("/theme mono")).toEqual({ kind: "theme", name: "mono" });
    expect(parseChatInput("/models")).toEqual({ kind: "models" });
    expect(parseChatInput("/tools")).toEqual({ kind: "tools" });
  });

  it("still treats plain text as a message", () => {
    expect(parseChatInput("hello there")).toEqual({ kind: "message", text: "hello there" });
  });
});

describe("autocomplete matching", () => {
  it("filters commands by the typed prefix", () => {
    const m = matchCommands("/ag");
    expect(m.map((c) => c.name)).toEqual(["agent", "agents"]);
  });

  it("returns all commands for a bare slash", () => {
    expect(matchCommands("/")).toHaveLength(COMMANDS.length);
  });

  it("stops suggesting once an argument is being typed", () => {
    expect(matchCommands("/theme ")).toEqual([]);
    expect(matchCommands("/agent build")).toEqual([]);
  });

  it("returns nothing for non-command input", () => {
    expect(matchCommands("hello")).toEqual([]);
    expect(matchCommands("")).toEqual([]);
  });
});
