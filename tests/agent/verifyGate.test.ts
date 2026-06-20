import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRuntime } from "../../src/agent/AgentRuntime.js";
import { BUILTIN_AGENTS } from "../../src/agent/AgentDefinition.js";
import type { AgentConfig } from "../../src/types.js";
import { setSessionCwd, resetSessionCwd } from "../../src/tools/session.js";

const build = BUILTIN_AGENTS.find((a) => a.id === "build")!;
const plan = BUILTIN_AGENTS.find((a) => a.id === "plan")!;

function makeConfig(agent = build): AgentConfig {
  return {
    provider: { type: "ollama", baseUrl: "http://localhost:11434", model: "test", temperature: 0.1, maxTokens: 512 },
    verbose: false,
    maxSteps: 10,
    maxContextTokens: 8192,
    agent,
  };
}

/** Provider that returns each scripted step in order, as TEXT (forces parser path). */
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

function ctxText(rt: AgentRuntime): string {
  return rt.session.ctx.get().map((m) => m.content).join("\n");
}

describe("verification gate (F-3.2)", () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    resetSessionCwd();
  });

  it("injects one [VERIFY] turn before accepting a build answer that ran a mutation", async () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "iaa-vg-")));
    setSessionCwd(dir);
    const rt = new AgentRuntime(makeConfig(build));
    scriptedSteps(rt, [
      '<tool_call>{"name":"write_file","args":{"path":"a.txt","content":"hi"}}</tool_call>',
      "<answer>I created the file.</answer>", // first answer → should be gated
      "<answer>Verified: a.txt exists.</answer>", // after verify → accepted
    ]);
    const answer = await rt.run("create a.txt");
    expect(existsSync(join(dir, "a.txt"))).toBe(true);
    expect(ctxText(rt)).toContain("[VERIFY]");
    expect(answer).toContain("Verified");
  });

  it("does NOT gate a read-only plan answer", async () => {
    const rt = new AgentRuntime(makeConfig(plan));
    scriptedSteps(rt, ["<answer>Here is the plan: step 1, step 2.</answer>"]);
    const answer = await rt.run("plan it");
    expect(ctxText(rt)).not.toContain("[VERIFY]");
    expect(answer).toContain("plan");
  });

  it("does NOT gate a build answer when no mutation tool ran", async () => {
    const rt = new AgentRuntime(makeConfig(build));
    scriptedSteps(rt, ["<answer>Hello! Nothing to build.</answer>"]);
    const answer = await rt.run("hi");
    expect(ctxText(rt)).not.toContain("[VERIFY]");
    expect(answer).toContain("Hello");
  });
});

describe("best-effort recovery (F-3.3)", () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    resetSessionCwd();
  });

  it("injects one [RECOVERY] turn instead of a dead-end abort after 3 failures", async () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "iaa-rec-")));
    setSessionCwd(dir);
    const rt = new AgentRuntime(makeConfig(build));
    // Three failing bash calls with DIFFERENT args (so failure-escalation, not the
    // identical-call loop guard, triggers), then a final answer.
    scriptedSteps(rt, [
      '<tool_call>{"name":"bash","args":{"command":"exit 1 # a"}}</tool_call>',
      '<tool_call>{"name":"bash","args":{"command":"exit 1 # b"}}</tool_call>',
      '<tool_call>{"name":"bash","args":{"command":"exit 1 # c"}}</tool_call>',
      "<answer>I could not run the command; nothing was changed.</answer>",
    ]);
    const answer = await rt.run("do a thing");
    expect(ctxText(rt)).toContain("[RECOVERY]");
    expect(answer).toContain("could not");
  });
});
