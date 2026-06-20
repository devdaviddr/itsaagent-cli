import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Session } from "../../src/agent/Session.js";
import { SessionStore } from "../../src/agent/SessionStore.js";
import { AgentRuntime } from "../../src/agent/AgentRuntime.js";
import { BUILTIN_AGENTS } from "../../src/agent/AgentDefinition.js";
import type { AgentConfig } from "../../src/types.js";

const build = BUILTIN_AGENTS.find((a) => a.id === "build")!;
let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function populated(): Session {
  const s = new Session({ agent: build, model: "qwen-x", cwd: "/tmp/proj", maxTokens: 8192 });
  s.ctx.add({ role: "system", content: "sys" });
  s.ctx.add({ role: "user", content: "build me a thing" });
  s.ctx.add({ role: "assistant", content: "<answer>done</answer>" });
  s.recordTool("write_file", { path: "x.js" });
  return s;
}

describe("Session serialize/restore round-trip", () => {
  it("toJSON captures state and derives a title from the first user turn", () => {
    const j = populated().toJSON();
    expect(j.model).toBe("qwen-x");
    expect(j.agentId).toBe("build");
    expect(j.cwd).toBe("/tmp/proj");
    expect(j.messages).toHaveLength(3);
    expect(j.toolHistory).toEqual([{ name: "write_file", args: { path: "x.js" } }]);
    expect(j.title).toBe("build me a thing");
  });

  it("restores messages, tool history and id via SessionOptions", () => {
    const j = populated().toJSON();
    const restored = new Session({
      id: j.id,
      title: j.title,
      createdAt: j.createdAt,
      agent: build,
      model: j.model,
      cwd: j.cwd,
      maxTokens: 8192,
      messages: j.messages,
      toolHistory: j.toolHistory,
      transitions: j.transitions,
    });
    expect(restored.id).toBe(j.id);
    expect(restored.ctx.get().map((m) => m.content)).toEqual(j.messages.map((m) => m.content));
    expect(restored.hasHistory).toBe(true);
    expect(restored.examinedSummary()).toContain("x.js");
  });
});

describe("SessionStore", () => {
  it("saves, loads, and lists newest-first", async () => {
    dir = mkdtempSync(join(tmpdir(), "iaa-store-"));
    const store = new SessionStore(dir);
    const a = populated();
    await store.save(a);

    const loaded = await store.load(a.id);
    expect(loaded?.id).toBe(a.id);
    expect(loaded?.title).toBe("build me a thing");

    const b = populated();
    await store.save(b);
    const list = await store.list();
    expect(list.length).toBe(2);
    expect(await store.latestId()).toBeDefined();
  });

  it("returns undefined for a missing id and [] for an empty dir", async () => {
    dir = mkdtempSync(join(tmpdir(), "iaa-store-"));
    const store = new SessionStore(dir);
    expect(await store.load("nope")).toBeUndefined();
    expect(await store.list()).toEqual([]);
  });
});

describe("AgentRuntime restore", () => {
  it("rebuilds a session from config.restore (id + history preserved)", () => {
    const saved = populated().toJSON();
    const config: AgentConfig = {
      provider: { type: "ollama", baseUrl: "http://x", model: saved.model, temperature: 0.1, maxTokens: 512 },
      verbose: false,
      maxSteps: 5,
      maxContextTokens: 8192,
      agent: build,
      restore: saved,
    };
    const rt = new AgentRuntime(config);
    expect(rt.session.id).toBe(saved.id);
    expect(rt.session.hasHistory).toBe(true);
    expect(rt.session.ctx.get().some((m) => m.content === "build me a thing")).toBe(true);
  });
});
