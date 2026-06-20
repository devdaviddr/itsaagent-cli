import { describe, expect, it } from "vitest";
import { AgentRuntime } from "../../src/agent/AgentRuntime.js";
import { AgentRegistry } from "../../src/agent/AgentRegistry.js";
import { BUILTIN_AGENTS } from "../../src/agent/AgentDefinition.js";
import { GUIDED_PROCESS } from "../../src/agent/Process.js";
import { runProcess } from "../../src/agent/ProcessRunner.js";
import type { AgentConfig } from "../../src/types.js";

const plan = BUILTIN_AGENTS.find((a) => a.id === "plan")!;

function makeConfig(): AgentConfig {
  return {
    provider: { type: "ollama", baseUrl: "http://localhost:11434", model: "test", temperature: 0.1, maxTokens: 512 },
    verbose: false,
    maxSteps: 6,
    maxContextTokens: 8192,
    agent: plan,
  };
}

function scriptedSteps(rt: AgentRuntime, steps: string[]): void {
  let i = 0;
  (rt as unknown as { provider: unknown }).provider = {
    async *stream() {
      const text = steps[Math.min(i, steps.length - 1)];
      i++;
      for (const c of text) yield { delta: c, done: false };
      yield { delta: "", done: true };
    },
  };
  (rt as unknown as { toolUseMode: boolean | undefined }).toolUseMode = false;
}

describe("runProcess (guided: plan → build)", () => {
  it("runs both stages in order and returns the final stage's answer", async () => {
    const rt = new AgentRuntime(makeConfig());
    scriptedSteps(rt, ["<answer>PLAN: do the thing</answer>", "<answer>BUILT the thing</answer>"]);

    const stages: Array<{ index: number; label: string; agentId: string }> = [];
    const result = await runProcess(rt, new AgentRegistry(), GUIDED_PROCESS, "make a thing", {
      onStage: (index, label, agentId) => stages.push({ index, label, agentId }),
    });

    expect(result).toBe("BUILT the thing");
    expect(stages).toEqual([
      { index: 0, label: "plan", agentId: "plan" },
      { index: 1, label: "build", agentId: "build" },
    ]);
    // The session recorded the plan → build handoff.
    expect(rt.session.transitions.some((t) => t.from === "plan" && t.to === "build")).toBe(true);
    expect(rt.agentId).toBe("build");
  });

  it("throws on a process with no stages", async () => {
    const rt = new AgentRuntime(makeConfig());
    scriptedSteps(rt, ["<answer>x</answer>"]);
    await expect(runProcess(rt, new AgentRegistry(), { id: "empty", title: "", description: "", stages: [] }, "t")).rejects.toThrow(/no stages/);
  });
});
