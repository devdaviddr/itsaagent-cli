import { describe, expect, it } from "vitest";
import { AgentRuntime } from "../../src/agent/AgentRuntime.js";
import { AgentRegistry } from "../../src/agent/AgentRegistry.js";
import { DEFAULT_AGENT_ID, type AgentDefinition } from "../../src/agent/AgentDefinition.js";
import { toAgentConfig, defaultConfig } from "../../src/cli/config.js";
import type { AgentConfig } from "../../src/types.js";

function makeConfig(agent?: AgentDefinition, overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    provider: { type: "ollama", baseUrl: "http://localhost:11434", model: "test", temperature: 0.1, maxTokens: 512 },
    verbose: false,
    maxSteps: 10,
    maxContextTokens: 8192,
    agent,
    ...overrides,
  };
}

/** Runtime that calls a single tool then answers, so we can observe the tool result. */
function withSingleToolCall(runtime: AgentRuntime, toolName: string) {
  let step = 0;
  (runtime as unknown as { provider: unknown }).provider = {
    async *stream() {
      step++;
      const text = step === 1
        ? `<tool_call>{"name":"${toolName}","args":{"command":"echo hi","path":"x"}}</tool_call>`
        : `<answer>done</answer>`;
      for (const c of text) yield { delta: c, done: false };
      yield { delta: "", done: true };
    },
  };
}

describe("AgentRegistry", () => {
  it("registers the two built-in agents", () => {
    const registry = new AgentRegistry();
    expect(registry.list().map((a) => a.id)).toEqual(["build", "plan"]);
  });

  it("default agent is build", async () => {
    const conf = await toAgentConfig(defaultConfig(), {});
    expect(conf.agent?.id).toBe(DEFAULT_AGENT_ID);
    expect(conf.agent?.id).toBe("build");
  });

  it("--agent plan resolves correctly", async () => {
    expect((await toAgentConfig(defaultConfig(), { agent: "plan" })).agent?.id).toBe("plan");
  });

  it("the removed cli agent no longer resolves", async () => {
    await expect(toAgentConfig(defaultConfig(), { agent: "cli" })).rejects.toThrow(/Unknown agent/);
  });

  it("rejects an unknown agent id", async () => {
    await expect(toAgentConfig(defaultConfig(), { agent: "nope" })).rejects.toThrow(/Unknown agent/);
  });
});

describe("Agent tool permissions", () => {
  it("build agent permits all tools", async () => {
    const build = new AgentRegistry().get("build")!;
    const runtime = new AgentRuntime(makeConfig(build));
    withSingleToolCall(runtime, "bash");
    const results: boolean[] = [];
    runtime.on("tool:result", ({ result }) => results.push(result.success || result.error !== "Tool not permitted by active agent"));
    await runtime.run("run a command");
    // build is allowed to call bash — it should not be blocked by permissions
    expect(results.some((ok) => ok)).toBe(true);
  });

  it("plan agent blocks bash with the permission error", async () => {
    const plan = new AgentRegistry().get("plan")!;
    const runtime = new AgentRuntime(makeConfig(plan));
    withSingleToolCall(runtime, "bash");
    const errors: (string | undefined)[] = [];
    runtime.on("tool:result", ({ result }) => errors.push(result.error));
    await runtime.run("run a command");
    expect(errors.some((e) => e?.includes("Tool not permitted by active agent"))).toBe(true);
  });

  it("plan agent blocks write_file with the permission error", async () => {
    const plan = new AgentRegistry().get("plan")!;
    const runtime = new AgentRuntime(makeConfig(plan));
    withSingleToolCall(runtime, "write_file");
    const errors: (string | undefined)[] = [];
    runtime.on("tool:result", ({ result }) => errors.push(result.error));
    await runtime.run("write a file");
    expect(errors.some((e) => e?.includes("Tool not permitted by active agent"))).toBe(true);
  });
});

describe("Agent system prompt scoping", () => {
  function systemPrompt(runtime: AgentRuntime): string {
    runtime.initSession();
    const ctx = (runtime as unknown as { ctx: { get(): { role: string; content: string }[] } }).ctx;
    return ctx.get().find((m) => m.role === "system")!.content;
  }

  it("plan system prompt omits bash but includes read_file", () => {
    const plan = new AgentRegistry().get("plan")!;
    const prompt = systemPrompt(new AgentRuntime(makeConfig(plan)));
    expect(prompt).toContain("### read_file");
    expect(prompt).not.toContain("### bash");
    expect(prompt).toContain("## Plan Agent");
  });

  it("build system prompt includes all tools", () => {
    const build = new AgentRegistry().get("build")!;
    const prompt = systemPrompt(new AgentRuntime(makeConfig(build)));
    expect(prompt).toContain("### bash");
    expect(prompt).toContain("### read_file");
  });
});

describe("Runtime agent/model switching (M-03)", () => {
  it("agentId and model getters reflect the active config", () => {
    const build = new AgentRegistry().get("build")!;
    const runtime = new AgentRuntime(makeConfig(build));
    expect(runtime.agentId).toBe("build");
    expect(runtime.model).toBe("test");
  });

  it("setModel changes the active model", () => {
    const runtime = new AgentRuntime(makeConfig());
    runtime.setModel("other-model:7b");
    expect(runtime.model).toBe("other-model:7b");
  });

  it("setAgent re-scopes permitted tools — switching build→plan blocks bash", async () => {
    const registry = new AgentRegistry();
    const runtime = new AgentRuntime(makeConfig(registry.get("build")!));
    runtime.setAgent(registry.get("plan")!);
    withSingleToolCall(runtime, "bash");
    const errors: (string | undefined)[] = [];
    runtime.on("tool:result", ({ result }) => errors.push(result.error));
    await runtime.run("try bash");
    expect(errors.some((e) => e?.includes("Tool not permitted by active agent"))).toBe(true);
  });
});
