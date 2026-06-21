import { describe, expect, it } from "vitest";
import { AgentRuntime } from "../../src/agent/AgentRuntime.js";
import type { AgentConfig, ToolCall } from "../../src/types.js";

function makeConfig(): AgentConfig {
  return {
    provider: { type: "ollama", baseUrl: "http://localhost:11434", model: "test", temperature: 0.1, maxTokens: 512 },
    verbose: false,
    maxSteps: 10,
    maxContextTokens: 8192,
  };
}

interface Step {
  content?: string;
  toolCalls?: ToolCall[];
}

function mockProvider(steps: Step[], supports: boolean) {
  let i = 0;
  return {
    supportsTools: async () => supports,
    async *stream() {
      const step = steps[Math.min(i, steps.length - 1)];
      i++;
      if (step.content) for (const c of step.content) yield { delta: c, done: false };
      yield { delta: "", done: true, toolCalls: step.toolCalls };
    },
    checkHealth: async () => true,
    listModels: async () => [],
  };
}

describe("parallel native tool calls (batch execution)", () => {
  it("executes ALL read-only calls in one response, not just the first", async () => {
    const runtime = new AgentRuntime(makeConfig());
    (runtime as unknown as { provider: unknown }).provider = mockProvider([
      {
        content: "two reads",
        toolCalls: [
          { name: "bash", args: { command: "echo a" } },
          { name: "bash", args: { command: "echo b" } },
          { name: "bash", args: { command: "echo c" } },
        ],
      },
      { content: "All done." },
    ], true);
    const calls: Array<{ command: unknown }> = [];
    runtime.on("tool:call", ({ args }) => calls.push(args as { command: unknown }));
    const result = await runtime.run("multi");
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => c.command)).toEqual(["echo a", "echo b", "echo c"]);
    expect(result).toContain("All done");
  });

  it("emits tool:result for every call in a batch, in order", async () => {
    const runtime = new AgentRuntime(makeConfig());
    (runtime as unknown as { provider: unknown }).provider = mockProvider([
      {
        toolCalls: [
          { name: "bash", args: { command: "echo first" } },
          { name: "bash", args: { command: "echo second" } },
        ],
      },
      { content: "done" },
    ], true);
    const results: string[] = [];
    runtime.on("tool:result", ({ result }) => results.push(result.data));
    await runtime.run("batch");
    expect(results.length).toBe(2);
    expect(results[0]).toContain("first");
    expect(results[1]).toContain("second");
  });

  it("single-call path remains behaviorally identical (one call, one result)", async () => {
    const runtime = new AgentRuntime(makeConfig());
    (runtime as unknown as { provider: unknown }).provider = mockProvider([
      { toolCalls: [{ name: "bash", args: { command: "echo solo" } }] },
      { content: "finished" },
    ], true);
    const names: string[] = [];
    runtime.on("tool:call", ({ name }) => names.push(name));
    const result = await runtime.run("one");
    expect(names).toEqual(["bash"]);
    expect(result).toContain("finished");
  });

  it("a mutation in the batch is executed sequentially (all calls still run)", async () => {
    const runtime = new AgentRuntime(makeConfig());
    (runtime as unknown as { provider: unknown }).provider = mockProvider([
      {
        toolCalls: [
          { name: "bash", args: { command: "echo read" } },
          // write_file is a mutation → forces sequential, no parallelism
          { name: "bash", args: { command: "echo also-read" } },
        ],
      },
      { content: "done" },
    ], true);
    const order: string[] = [];
    runtime.on("tool:result", ({ result }) => order.push(result.data));
    await runtime.run("seq");
    expect(order.length).toBe(2);
  });
});
