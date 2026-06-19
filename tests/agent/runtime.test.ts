import { describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "../../src/agent/AgentRuntime.js";
import type { AgentConfig } from "../../src/types.js";

function makeMockProvider(responses: string[]) {
  let idx = 0;
  return {
    async *stream() {
      const text = responses[idx++ % responses.length] ?? "<answer>done</answer>";
      for (const char of text) {
        yield { delta: char, done: false };
      }
      yield { delta: "", done: true };
    },
    checkHealth: async () => true,
    listModels: async () => [],
  };
}

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    provider: { type: "ollama", baseUrl: "http://localhost:11434", model: "test", temperature: 0.1, maxTokens: 512 },
    verbose: false,
    maxSteps: 10,
    maxContextTokens: 8192,
    ...overrides,
  };
}

describe("AgentRuntime", () => {
  it("returns final answer from <answer> tag", async () => {
    const runtime = new AgentRuntime(makeConfig());
    // Monkey-patch provider
    (runtime as unknown as { provider: unknown }).provider = makeMockProvider([
      "<thought>thinking</thought><answer>The answer is 42.</answer>",
    ]);
    const result = await runtime.run("what is 6 x 7?");
    expect(result).toBe("The answer is 42.");
  });

  it("emits answer event with the final text", async () => {
    const runtime = new AgentRuntime(makeConfig());
    (runtime as unknown as { provider: unknown }).provider = makeMockProvider([
      "<answer>hello</answer>",
    ]);
    const answers: string[] = [];
    runtime.on("answer", ({ text }) => answers.push(text));
    await runtime.run("say hello");
    expect(answers).toEqual(["hello"]);
  });

  it("executes a tool call and continues the loop", async () => {
    const runtime = new AgentRuntime(makeConfig());
    let step = 0;
    (runtime as unknown as { provider: unknown }).provider = {
      async *stream() {
        step++;
        const text = step === 1
          ? `<tool_call>{"name":"bash","args":{"command":"echo hi"}}</tool_call>`
          : `<answer>Done. Output was: hi</answer>`;
        for (const c of text) yield { delta: c, done: false };
        yield { delta: "", done: true };
      },
    };
    const toolCallEvents: string[] = [];
    runtime.on("tool:call", ({ name }) => toolCallEvents.push(name));
    const result = await runtime.run("echo hi");
    expect(toolCallEvents).toContain("bash");
    expect(result).toContain("Done");
  });

  it("detects a loop and aborts when same tool called 3 times", async () => {
    const runtime = new AgentRuntime(makeConfig({ maxSteps: 10 }));
    (runtime as unknown as { provider: unknown }).provider = makeMockProvider([
      `<tool_call>{"name":"bash","args":{"command":"ls"}}</tool_call>`,
    ]);
    const errors: string[] = [];
    runtime.on("error", ({ error }) => errors.push(error.code));
    const result = await runtime.run("keep running ls");
    expect(result).toMatch(/loop/i);
    expect(errors).toContain("LOOP_DETECTED");
  });

  it("returns MaxStepsError message when steps exhausted", async () => {
    const runtime = new AgentRuntime(makeConfig({ maxSteps: 2 }));
    (runtime as unknown as { provider: unknown }).provider = makeMockProvider([
      `<tool_call>{"name":"bash","args":{"command":"echo step"}}</tool_call>`,
      `<tool_call>{"name":"bash","args":{"command":"echo step2"}}</tool_call>`,
    ]);
    // Override loop detection by varying args slightly
    let n = 0;
    (runtime as unknown as { provider: unknown }).provider = {
      async *stream() {
        n++;
        const text = `<tool_call>{"name":"bash","args":{"command":"echo ${n}"}}</tool_call>`;
        for (const c of text) yield { delta: c, done: false };
        yield { delta: "", done: true };
      },
    };
    const result = await runtime.run("run forever");
    expect(result).toMatch(/max steps/i);
  });

  it("verbose getter reflects config", () => {
    const r1 = new AgentRuntime(makeConfig({ verbose: true }));
    const r2 = new AgentRuntime(makeConfig({ verbose: false }));
    expect(r1.verbose).toBe(true);
    expect(r2.verbose).toBe(false);
  });

  it("emits context:usage with sane values during a run", async () => {
    const runtime = new AgentRuntime(makeConfig());
    (runtime as unknown as { provider: unknown }).provider = makeMockProvider([
      "<answer>done</answer>",
    ]);
    const usages: Array<{ used: number; max: number; ratio: number }> = [];
    runtime.on("context:usage", (u) => usages.push(u));
    await runtime.run("hello");
    expect(usages.length).toBeGreaterThan(0);
    const last = usages[usages.length - 1];
    expect(last.max).toBe(8192);
    expect(last.used).toBeGreaterThan(0);
    expect(last.ratio).toBeGreaterThanOrEqual(0);
  });
});
