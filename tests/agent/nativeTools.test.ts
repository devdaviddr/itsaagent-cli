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

/** Mock provider that drives one Step per stream() call and reports tool support. */
function mockProvider(steps: Step[], supports: boolean) {
  let i = 0;
  return {
    supportsTools: async () => supports,
    async *stream() {
      const step = steps[Math.min(i, steps.length - 1)];
      i++;
      if (step.content) {
        for (const c of step.content) yield { delta: c, done: false };
      }
      yield { delta: "", done: true, toolCalls: step.toolCalls };
    },
    checkHealth: async () => true,
    listModels: async () => [],
  };
}

describe("F-09 native tool use", () => {
  it("extracts a native tool_call without the text parser", async () => {
    const runtime = new AgentRuntime(makeConfig());
    // raw content is plain prose — NOT <tool_call> format. Only native extraction can find the call.
    (runtime as unknown as { provider: unknown }).provider = mockProvider([
      { content: "Let me list the directory.", toolCalls: [{ name: "bash", args: { command: "echo hi" } }] },
      { content: "All done." },
    ], true);
    const calls: string[] = [];
    runtime.on("tool:call", ({ name }) => calls.push(name));
    const result = await runtime.run("list dir");
    expect(calls).toContain("bash");
    expect(result).toContain("All done");
  });

  it("emits the content as a thought alongside a native tool call", async () => {
    const runtime = new AgentRuntime(makeConfig());
    (runtime as unknown as { provider: unknown }).provider = mockProvider([
      { content: "thinking about it", toolCalls: [{ name: "bash", args: { command: "echo x" } }] },
      { content: "done" },
    ], true);
    const thoughts: string[] = [];
    runtime.on("thought", ({ text }) => thoughts.push(text));
    await runtime.run("go");
    expect(thoughts).toContain("thinking about it");
  });

  it("treats native content with no tool_calls as the final answer", async () => {
    const runtime = new AgentRuntime(makeConfig());
    (runtime as unknown as { provider: unknown }).provider = mockProvider([
      { content: "the answer is 42" },
    ], true);
    const calls: string[] = [];
    runtime.on("tool:call", ({ name }) => calls.push(name));
    const result = await runtime.run("question");
    expect(result).toBe("the answer is 42");
    expect(calls).toHaveLength(0);
  });

  it("falls back to the text parser when the model is not tool-capable", async () => {
    const runtime = new AgentRuntime(makeConfig());
    (runtime as unknown as { provider: unknown }).provider = mockProvider([
      { content: `<tool_call>{"name":"bash","args":{"command":"echo hi"}}</tool_call>` },
      { content: `<answer>parsed path works</answer>` },
    ], false);
    const calls: string[] = [];
    runtime.on("tool:call", ({ name }) => calls.push(name));
    const result = await runtime.run("do it");
    expect(calls).toContain("bash");
    expect(result).toContain("parsed path works");
  });
});
