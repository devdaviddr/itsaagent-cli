import { describe, expect, it } from "vitest";
import { compactMessages } from "../../src/agent/compaction.js";
import { ContextManager } from "../../src/agent/ContextManager.js";
import type { Message } from "../../src/types.js";

const m = (role: Message["role"], content: string): Message => ({ role, content, timestamp: 0 });

describe("compactMessages (structured)", () => {
  it("stubs a superseded read, truncates old tool output, keeps recent + pinned verbatim", () => {
    const msgs: Message[] = [
      m("system", "sys"), // 0 pinned
      m("user", "task"), // 1 pinned
      m("user", '[TOOL RESULT: read_file — OK] {"path":"a.js"}\nold1\nold2\nold3'), // 2 superseded by 4
      m("user", '[TOOL RESULT: bash — OK] {"command":"ls"}\n' + "abcdefghij".repeat(70)), // 3 truncated (700-char payload)
      m("user", '[TOOL RESULT: read_file — OK] {"path":"a.js"}\nnew1\nnew2'), // 4 (latest a.js)
      m("user", "some thought"), // 5 not a tool result → kept
      m("assistant", "<answer>partial</answer>"), // 6 recent
      m("user", "newest"), // 7 recent + lastIndex
    ];
    const pinned = (i: number) => i === 0 || i === 1;
    const { messages: out, changed } = compactMessages(msgs, pinned, { recentWindow: 2 });

    expect(changed).toBe(true);
    expect(out[0].content).toBe("sys"); // pinned untouched
    expect(out[1].content).toBe("task");
    expect(out[2].content).toMatch(/superseded/); // older read of a.js stubbed
    expect(out[2].content).not.toContain("old1");
    expect(out[3].content).toContain("abcdefghij"); // start of payload preserved
    expect(out[3].content).toContain("trimmed");
    expect(out[3].content.length).toBeLessThan(msgs[3].content.length); // genuinely shrunk
    expect(out[5].content).toBe("some thought"); // non-tool-result untouched
    expect(out[6].content).toBe("<answer>partial</answer>"); // recent window verbatim
    expect(out[7].content).toBe("newest");
  });

  it("does nothing when there is nothing old to compact", () => {
    const msgs = [m("system", "sys"), m("user", "task"), m("assistant", "<answer>hi</answer>")];
    const { changed } = compactMessages(msgs, (i) => i < 2, { recentWindow: 6 });
    expect(changed).toBe(false);
  });
});

describe("ContextManager structured compaction at threshold", () => {
  it("shrinks old tool results in place instead of growing unbounded", () => {
    // Budget large enough to hold >recentWindow messages (so compaction, not
    // eviction, is what acts); low threshold so it triggers early.
    const ctx = new ContextManager(4000, undefined, undefined, undefined, "structured", 0.3);
    ctx.add({ role: "system", content: "sys" });
    ctx.add({ role: "user", content: "do the task" });
    for (let i = 0; i < 20; i++) {
      ctx.add({ role: "user", content: `[TOOL RESULT: bash — OK] {"command":"c${i}"}\n${"x".repeat(700)}` });
    }
    const msgs = ctx.get();
    // The original task survives.
    expect(msgs.some((mm) => mm.content === "do the task")).toBe(true);
    // An early tool result was compacted (truncated), not left at full size.
    const earlyTrimmed = msgs.some((mm) => mm.content.startsWith("[TOOL RESULT: bash") && mm.content.includes("trimmed"));
    expect(earlyTrimmed).toBe(true);
  });

  it("off mode leaves tool results untouched until hard eviction", () => {
    const ctx = new ContextManager(100000, undefined, undefined, undefined, "off");
    ctx.add({ role: "system", content: "sys" });
    ctx.add({ role: "user", content: '[TOOL RESULT: bash — OK] {"command":"x"}\n' + "y".repeat(500) });
    expect(ctx.get()[1].content).toContain("y".repeat(500));
  });
});

describe("ContextManager.foldOlder (LLM-summarize support)", () => {
  it("replaces older turns with one pinned summary, keeping task + recent", () => {
    const ctx = new ContextManager(100000);
    ctx.add({ role: "system", content: "sys" });
    ctx.add({ role: "user", content: "the original task" });
    for (let i = 0; i < 8; i++) ctx.add({ role: "user", content: `older ${i}` });
    ctx.add({ role: "assistant", content: "recent reply" });

    const { count } = ctx.olderMessagesText(2);
    expect(count).toBeGreaterThan(0);
    const folded = ctx.foldOlder("FACTS: did X, files a.js, remains Y.", 2);
    expect(folded).toBe(true);

    const msgs = ctx.get();
    const summary = msgs.find((m) => m.content.startsWith("[CONVERSATION SUMMARY"));
    expect(summary).toBeDefined();
    expect(summary?.pinned).toBe(true);
    expect(summary?.content).toContain("FACTS: did X");
    // Task and the most recent message survive; the bulk of "older N" is gone.
    expect(msgs.some((m) => m.content === "the original task")).toBe(true);
    expect(msgs.some((m) => m.content === "recent reply")).toBe(true);
    expect(msgs.filter((m) => m.content.startsWith("older ")).length).toBeLessThan(8);
  });
});
