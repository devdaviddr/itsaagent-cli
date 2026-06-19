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

describe("F-07 cooperative cancellation", () => {
  it("cancel() stops the loop and resolves with a cancelled outcome", async () => {
    const runtime = new AgentRuntime(makeConfig());
    (runtime as unknown as { provider: unknown }).provider = scripted([tc("bash", { command: "echo hi" }), answer]);

    let cancelledFired = false;
    let answered = false;
    runtime.on("cancelled", () => {
      cancelledFired = true;
    });
    runtime.on("answer", () => {
      answered = true;
    });
    // Ask to cancel as soon as the first token streams in.
    runtime.on("chunk", () => runtime.cancel());

    const result = await runtime.run("go");
    expect(cancelledFired).toBe(true);
    expect(answered).toBe(false);
    expect(result).toBe("[cancelled]");
  });

  it("cancel() is a no-op (no event) when idle", () => {
    const runtime = new AgentRuntime(makeConfig());
    let fired = false;
    runtime.on("cancelled", () => {
      fired = true;
    });
    runtime.cancel();
    runtime.cancel();
    expect(fired).toBe(false);
  });

  it("resets between runs so a later run completes normally", async () => {
    const runtime = new AgentRuntime(makeConfig());
    (runtime as unknown as { provider: unknown }).provider = scripted([answer]);
    runtime.cancel(); // idle no-op
    const result = await runtime.run("go");
    expect(result).toBe("done");
  });
});
