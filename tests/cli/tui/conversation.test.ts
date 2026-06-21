import { describe, expect, it } from "vitest";
import {
  conversationReducer,
  initialConversation,
  type ConvAction,
  type ConversationState,
  type ToolEntry,
} from "../../../src/cli/tui/state/conversation.js";
import type { ToolResult } from "../../../src/types.js";

function run(actions: ConvAction[], start = initialConversation()): ConversationState {
  return actions.reduce(conversationReducer, start);
}

const ok: ToolResult = { success: true, data: "hello\nworld" };
const fail: ToolResult = { success: false, data: "", error: "boom" };

describe("conversation reducer — event sequence", () => {
  it("maps a representative run to an ordered entry list", () => {
    const state = run([
      { type: "user", text: "do the thing" },
      { type: "step", index: 1 },
      { type: "chunk", delta: "I will " },
      { type: "chunk", delta: "read the file" },
      { type: "thought", text: "read the file", stepIndex: 1 },
      { type: "tool:call", name: "read_file", args: { path: "a.ts" }, stepIndex: 1 },
      { type: "tool:result", result: ok, stepIndex: 1 },
      { type: "answer", text: "done" },
    ]);

    expect(state.entries.map((e) => e.kind)).toEqual([
      "user",
      "thought",
      "tool",
      "answer",
    ]);
    const tool = state.entries.find((e) => e.kind === "tool") as ToolEntry;
    expect(tool.status).toBe("success");
    expect(tool.result).toEqual(ok);
    expect(tool.expanded).toBe(false);
  });

  it("marks a failed tool result as error and attaches it to the running call", () => {
    const state = run([
      { type: "step", index: 1 },
      { type: "tool:call", name: "bash", args: { command: "x" }, stepIndex: 1 },
      { type: "tool:result", result: fail, stepIndex: 1 },
    ]);
    const tool = state.entries.find((e) => e.kind === "tool") as ToolEntry;
    expect(tool.status).toBe("error");
    expect(tool.result?.error).toBe("boom");
  });

  it("assigns unique incrementing ids", () => {
    const state = run([
      { type: "notice", text: "a" },
      { type: "notice", text: "b" },
      { type: "notice", text: "c" },
    ]);
    expect(state.entries.map((e) => e.id)).toEqual([1, 2, 3]);
  });
});

describe("conversation reducer — reset", () => {
  it("wipes the transcript entirely (used by /clear)", () => {
    let state = run([
      { type: "user", text: "hi" },
      { type: "answer", text: "hello" },
      { type: "notice", text: "something" },
      { type: "scrollUp", lines: 5 },
    ]);
    expect(state.entries.length).toBeGreaterThan(0);
    state = conversationReducer(state, { type: "reset" });
    expect(state.entries).toEqual([]);
    expect(state.nextId).toBe(1);
    expect(state.scrollOffset).toBe(0);
    expect(state.following).toBe(true);
  });
});

describe("conversation reducer — bounded live buffer", () => {
  it("accumulates chunks then clears on the step boundary", () => {
    let state = run([
      { type: "step", index: 1 },
      { type: "chunk", delta: "abc" },
      { type: "chunk", delta: "def" },
    ]);
    expect(state.live).toBe("abcdef");

    // Finalising into a thought clears the buffer (no whole-run concatenation).
    state = conversationReducer(state, { type: "thought", text: "abcdef", stepIndex: 1 });
    expect(state.live).toBe("");

    // A new step also resets it.
    state = run(
      [
        { type: "chunk", delta: "next" },
        { type: "step", index: 2 },
      ],
      state,
    );
    expect(state.live).toBe("");
  });

  it("answer and error also reset the live buffer", () => {
    const answered = run([{ type: "chunk", delta: "x" }, { type: "answer", text: "y" }]);
    expect(answered.live).toBe("");
    const errored = run([{ type: "chunk", delta: "x" }, { type: "error", text: "nope" }]);
    expect(errored.live).toBe("");
  });
});

describe("conversation reducer — scroll state machine", () => {
  it("scrolling up pauses follow and increases offset", () => {
    const state = run([{ type: "scrollUp", lines: 3 }]);
    expect(state.following).toBe(false);
    expect(state.scrollOffset).toBe(3);
  });

  it("scrolling back to the bottom resumes follow", () => {
    const state = run([
      { type: "scrollUp", lines: 5 },
      { type: "scrollDown", lines: 2 },
    ]);
    expect(state.following).toBe(false);
    expect(state.scrollOffset).toBe(3);

    const back = conversationReducer(state, { type: "scrollDown", lines: 10 });
    expect(back.scrollOffset).toBe(0);
    expect(back.following).toBe(true);
  });

  it("clamps the offset to max so it can't inflate past the top", () => {
    // Repeated scrollUp with a max never exceeds it (no scroll-down dead zone).
    const state = run([
      { type: "scrollUp", lines: 50, max: 10 },
      { type: "scrollUp", lines: 50, max: 10 },
    ]);
    expect(state.scrollOffset).toBe(10);
    expect(state.following).toBe(false);
    // One scrollDown immediately moves the view (offset was clamped, not phantom).
    const down = conversationReducer(state, { type: "scrollDown", lines: 4 });
    expect(down.scrollOffset).toBe(6);
  });

  it("scrollUp without a max is unbounded (back-compat)", () => {
    const state = run([{ type: "scrollUp", lines: 99 }]);
    expect(state.scrollOffset).toBe(99);
  });

  it("scrollToTail snaps to the bottom and follows", () => {
    const state = run([
      { type: "scrollUp", lines: 99 },
      { type: "scrollToTail" },
    ]);
    expect(state.scrollOffset).toBe(0);
    expect(state.following).toBe(true);
  });
});

describe("conversation reducer — tool expansion", () => {
  it("toggles a single tool block and all at once", () => {
    let state = run([
      { type: "tool:call", name: "a", args: {}, stepIndex: 1 },
      { type: "tool:call", name: "b", args: {}, stepIndex: 2 },
    ]);
    const firstId = state.entries[0].id;
    state = conversationReducer(state, { type: "toggleExpand", id: firstId });
    expect((state.entries[0] as ToolEntry).expanded).toBe(true);
    expect((state.entries[1] as ToolEntry).expanded).toBe(false);

    state = conversationReducer(state, { type: "toggleExpandAll", expanded: true });
    expect(state.entries.every((e) => e.kind !== "tool" || e.expanded)).toBe(true);
  });
});
