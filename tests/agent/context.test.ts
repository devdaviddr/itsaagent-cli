import { describe, expect, it } from "vitest";
import { ContextManager } from "../../src/agent/ContextManager.js";

describe("ContextManager", () => {
  it("stores and retrieves messages", () => {
    const ctx = new ContextManager(10000);
    ctx.add({ role: "system", content: "You are an agent." });
    ctx.add({ role: "user", content: "Hello" });
    const msgs = ctx.get();
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].role).toBe("user");
  });

  it("get() returns a copy not a reference", () => {
    const ctx = new ContextManager(10000);
    ctx.add({ role: "user", content: "test" });
    const msgs = ctx.get();
    msgs.push({ role: "assistant", content: "mutated", timestamp: 0 });
    expect(ctx.get()).toHaveLength(1);
  });

  it("forProvider() strips timestamps", () => {
    const ctx = new ContextManager(10000);
    ctx.add({ role: "system", content: "sys" });
    ctx.add({ role: "user", content: "hi" });
    const msgs = ctx.forProvider();
    expect(msgs[0]).toEqual({ role: "system", content: "sys" });
    expect("timestamp" in msgs[0]).toBe(false);
  });

  it("trims old tool results but keeps system and original task", () => {
    // 3.5 chars/token. limit 20 tokens = 70 chars
    const ctx = new ContextManager(20);
    ctx.add({ role: "system", content: "system" });           // ~2 tokens
    ctx.add({ role: "user", content: "task" });               // ~2 tokens
    ctx.add({ role: "user", content: "a".repeat(30) });       // ~9 tokens - tool result
    ctx.add({ role: "user", content: "b".repeat(30) });       // ~9 tokens - tool result

    const msgs = ctx.get();
    // System prompt must be preserved
    expect(msgs.find((m) => m.content === "system")).toBeDefined();
    // Original task must be preserved
    expect(msgs.find((m) => m.content === "task")).toBeDefined();
    // The newest tool result should survive over the oldest
    const contents = msgs.map((m) => m.content);
    expect(contents).toContain("b".repeat(30));
  });

  it("clear() keeps the system message only", () => {
    const ctx = new ContextManager(10000);
    ctx.add({ role: "system", content: "You are an agent." });
    ctx.add({ role: "user", content: "task" });
    ctx.add({ role: "assistant", content: "thinking..." });
    ctx.clear();
    const msgs = ctx.get();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("system");
  });

  it("clear() on empty context leaves empty", () => {
    const ctx = new ContextManager(10000);
    ctx.clear();
    expect(ctx.get()).toHaveLength(0);
  });

  it("usage() reports correct ratio", () => {
    const ctx = new ContextManager(100);
    ctx.add({ role: "user", content: "a".repeat(35) });
    const usage = ctx.usage();
    expect(usage.total).toBeGreaterThan(0);
    expect(usage.max).toBe(100);
    expect(usage.ratio).toBeGreaterThan(0);
  });

  it("injects a context notice after eviction", () => {
    const ctx = new ContextManager(40);
    ctx.add({ role: "system", content: "sys" });
    ctx.add({ role: "user", content: "task" });
    ctx.add({ role: "assistant", content: "x".repeat(120) });
    ctx.add({ role: "user", content: "y".repeat(120) });
    const notice = ctx.get().find((m) => m.notice);
    expect(notice).toBeDefined();
    expect(notice?.content).toMatch(/CONTEXT NOTICE/);
  });

  it("fires the onEvict callback with the evicted count", () => {
    const counts: number[] = [];
    const ctx = new ContextManager(40, (n) => counts.push(n));
    ctx.add({ role: "system", content: "sys" });
    ctx.add({ role: "user", content: "task" });
    ctx.add({ role: "user", content: "z".repeat(200) });
    ctx.add({ role: "user", content: "w".repeat(200) });
    expect(counts.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it("keeps a single accumulating notice across repeated evictions", () => {
    const ctx = new ContextManager(40);
    ctx.add({ role: "system", content: "sys" });
    ctx.add({ role: "user", content: "task" });
    for (let i = 0; i < 6; i++) {
      ctx.add({ role: "user", content: `result ${i} `.repeat(20) });
    }
    const notices = ctx.get().filter((m) => m.notice);
    expect(notices).toHaveLength(1);
  });

  it("clear() removes the notice and resets eviction state", () => {
    const ctx = new ContextManager(40);
    ctx.add({ role: "system", content: "sys" });
    ctx.add({ role: "user", content: "task" });
    ctx.add({ role: "user", content: "q".repeat(200) });
    ctx.add({ role: "user", content: "r".repeat(200) });
    expect(ctx.get().some((m) => m.notice)).toBe(true);
    ctx.clear();
    expect(ctx.get().some((m) => m.notice)).toBe(false);
  });
});
