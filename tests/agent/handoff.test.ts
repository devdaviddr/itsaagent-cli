import { describe, expect, it } from "vitest";
import { AgentRuntime } from "../../src/agent/AgentRuntime.js";
import { BUILTIN_AGENTS } from "../../src/agent/AgentDefinition.js";
import type { AgentConfig } from "../../src/types.js";

const build = BUILTIN_AGENTS.find((a) => a.id === "build")!;
const plan = BUILTIN_AGENTS.find((a) => a.id === "plan")!;

function makeConfig(agent = plan): AgentConfig {
  return {
    provider: { type: "ollama", baseUrl: "http://localhost:11434", model: "test", temperature: 0.1, maxTokens: 512 },
    verbose: false,
    maxSteps: 5,
    maxContextTokens: 8192,
    agent,
  };
}

/** Provider that answers immediately so the handoff's build loop ends after one step. */
function scripted(text: string) {
  return {
    async *stream() {
      for (const c of text) yield { delta: c, done: false };
      yield { delta: "", done: true };
    },
    checkHealth: async () => true,
    listModels: async () => [],
  };
}

function ctxText(runtime: AgentRuntime): string {
  return runtime.session.ctx.get().map((m) => m.content).join("\n");
}

describe("F-02 plan → build handoff", () => {
  it("switches the active agent to build", async () => {
    const runtime = new AgentRuntime(makeConfig(plan));
    (runtime as unknown as { provider: unknown }).provider = scripted("<answer>done</answer>");
    expect(runtime.agentId).toBe("plan");
    await runtime.handoffToBuild(build, "make a thing");
    expect(runtime.agentId).toBe("build");
  });

  it("seeds build with the plan + a compact summary of what plan examined", async () => {
    const runtime = new AgentRuntime(makeConfig(plan));
    runtime.session.recordTool("read_file", { path: "src/x.ts" });
    runtime.session.recordTool("bash", { command: "ls -la" });
    (runtime as unknown as { provider: unknown }).provider = scripted("<answer>done</answer>");

    await runtime.handoffToBuild(build, "1. create x.ts\n2. run tests");

    const ctx = ctxText(runtime);
    expect(ctx).toContain("1. create x.ts"); // the plan is carried over
    expect(ctx).toContain("Files read: src/x.ts"); // the compact summary is carried over
    expect(ctx).toContain("Commands run: ls -la");
    // build's system prompt is in scope (build has all tools, incl. write_file)
    expect(ctx).toContain("### write_file");
  });

  it("does NOT carry the raw planning tool-result dumps", async () => {
    const runtime = new AgentRuntime(makeConfig(plan));
    // Simulate plan having read a file (its raw content would be a tool result)
    runtime.session.ctx.add({ role: "system", content: "plan system" });
    runtime.session.ctx.add({ role: "user", content: "[TOOL RESULT: read_file]\nSECRET_RAW_DUMP_CONTENTS" });
    runtime.session.recordTool("read_file", { path: "a.ts" });
    (runtime as unknown as { provider: unknown }).provider = scripted("<answer>done</answer>");

    await runtime.handoffToBuild(build, "the plan");

    expect(ctxText(runtime)).not.toContain("SECRET_RAW_DUMP_CONTENTS");
  });

  it("handoff with an empty history still carries the plan", async () => {
    const runtime = new AgentRuntime(makeConfig(plan));
    (runtime as unknown as { provider: unknown }).provider = scripted("<answer>done</answer>");
    await runtime.handoffToBuild(build, "do the thing");
    const ctx = ctxText(runtime);
    expect(ctx).toContain("do the thing");
    expect(ctx).toContain("nothing was examined");
  });
});
