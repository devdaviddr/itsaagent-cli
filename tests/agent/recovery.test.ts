import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentRuntime } from "../../src/agent/AgentRuntime.js";
import type { AgentConfig } from "../../src/types.js";

function makeConfig(): AgentConfig {
  return {
    provider: { type: "ollama", baseUrl: "http://localhost:11434", model: "test", temperature: 0.1, maxTokens: 512 },
    verbose: false,
    maxSteps: 15,
    maxContextTokens: 8192,
  };
}

const tc = (name: string, args: Record<string, unknown>) =>
  `<tool_call>{"name":"${name}","args":${JSON.stringify(args)}}</tool_call>`;
const answer = "<answer>done</answer>";

/** Provider that returns one scripted response per step; repeats the last when exhausted. */
function scripted(responses: string[]) {
  let i = 0;
  return {
    async *stream() {
      const t = responses[Math.min(i, responses.length - 1)];
      i++;
      for (const c of t) yield { delta: c, done: false };
      yield { delta: "", done: true };
    },
    checkHealth: async () => true,
    listModels: async () => [],
  };
}

function ctxText(runtime: AgentRuntime): string {
  const ctx = (runtime as unknown as { ctx: { get(): { content: string }[] } }).ctx;
  return ctx.get().map((m) => m.content).join("\n");
}

describe("R-04 loop and failure recovery", () => {
  it("nudges when the same tool is used 5+ times in the recency window", async () => {
    const runtime = new AgentRuntime(makeConfig());
    (runtime as unknown as { provider: unknown }).provider = scripted([
      tc("bash", { command: "echo 1" }),
      tc("bash", { command: "echo 2" }),
      tc("bash", { command: "echo 3" }),
      tc("bash", { command: "echo 4" }),
      tc("bash", { command: "echo 5" }),
      answer,
    ]);
    await runtime.run("loop");
    expect(ctxText(runtime)).toMatch(/called bash .* times recently/);
  });

  it("warns after two consecutive failures of the same tool", async () => {
    const runtime = new AgentRuntime(makeConfig());
    (runtime as unknown as { provider: unknown }).provider = scripted([
      tc("read_file", { path: "/no/such/a" }),
      tc("read_file", { path: "/no/such/b" }),
      answer,
    ]);
    await runtime.run("fail twice");
    expect(ctxText(runtime)).toMatch(/failed twice in a row/);
  });

  it("hard-aborts after three consecutive failures of the same tool", async () => {
    const runtime = new AgentRuntime(makeConfig());
    (runtime as unknown as { provider: unknown }).provider = scripted([
      tc("read_file", { path: "/no/such/a" }),
      tc("read_file", { path: "/no/such/b" }),
      tc("read_file", { path: "/no/such/c" }),
    ]);
    const result = await runtime.run("fail thrice");
    expect(result).toMatch(/failed 3 times consecutively/);
  });

  it("resets the failure counter on a successful call to the same tool", async () => {
    const dir = mkdtempSync(join(tmpdir(), "recovery-"));
    const real = join(dir, "ok.txt");
    writeFileSync(real, "hello");
    const runtime = new AgentRuntime(makeConfig());
    (runtime as unknown as { provider: unknown }).provider = scripted([
      tc("read_file", { path: "/no/such/a" }),
      tc("read_file", { path: "/no/such/b" }), // 2 fails — warning
      tc("read_file", { path: real }),          // success — resets read_file streak
      tc("read_file", { path: "/no/such/c" }),  // only 1 fail after reset
      answer,
    ]);
    const result = await runtime.run("recover");
    expect(result).toBe("done"); // did not abort — streak was reset by the successful read
  });

  it("still aborts on exact-match repeats (same tool + args)", async () => {
    const runtime = new AgentRuntime(makeConfig());
    (runtime as unknown as { provider: unknown }).provider = scripted([
      tc("bash", { command: "ls" }),
    ]);
    const result = await runtime.run("repeat");
    expect(result).toMatch(/loop/i);
  });
});
