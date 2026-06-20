import { describe, expect, it } from "vitest";
import { AgentRuntime } from "../../src/agent/AgentRuntime.js";
import { BUILTIN_AGENTS } from "../../src/agent/AgentDefinition.js";
import type { AgentConfig } from "../../src/types.js";

const build = BUILTIN_AGENTS.find((a) => a.id === "build")!;
const plan = BUILTIN_AGENTS.find((a) => a.id === "plan")!;

function makeConfig(agent = build): AgentConfig {
  return {
    provider: { type: "ollama", baseUrl: "http://localhost:11434", model: "test", temperature: 0.1, maxTokens: 512 },
    verbose: false,
    maxSteps: 5,
    maxContextTokens: 8192,
    agent,
  };
}

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

const askCall = (q: string) => `<tool_call>{"name":"ask_user","args":{"question":"${q}"}}</tool_call>`;

function ctxText(runtime: AgentRuntime): string {
  return runtime.session.ctx.get().map((m) => m.content).join("\n");
}

describe("F-03 ask_user", () => {
  it("routes to the handler and feeds the answer back into the loop", async () => {
    const runtime = new AgentRuntime(makeConfig(build));
    let asked = "";
    runtime.setAskUserHandler(async (q) => {
      asked = q;
      return "Barney";
    });
    (runtime as unknown as { provider: unknown }).provider = scripted([
      askCall("What name?"),
      "<answer>Greeted Barney</answer>",
    ]);

    const answer = await runtime.run("greet someone");
    expect(asked).toBe("What name?");
    expect(ctxText(runtime)).toContain("Barney"); // answer came back as the tool result
    expect(answer).toContain("Greeted Barney");
  });

  it("emits an 'ask' event with the question", async () => {
    const runtime = new AgentRuntime(makeConfig(build));
    let event = "";
    runtime.on("ask", ({ question }) => (event = question));
    runtime.setAskUserHandler(async () => "ok");
    (runtime as unknown as { provider: unknown }).provider = scripted([askCall("Which port?"), "<answer>done</answer>"]);
    await runtime.run("x");
    expect(event).toBe("Which port?");
  });

  it("is permitted for the read-only plan agent (not blocked)", async () => {
    const runtime = new AgentRuntime(makeConfig(plan));
    let asked = "";
    runtime.setAskUserHandler(async (q) => {
      asked = q;
      return "yes";
    });
    (runtime as unknown as { provider: unknown }).provider = scripted([askCall("Proceed?"), "<answer>ok</answer>"]);
    await runtime.run("plan something");
    expect(asked).toBe("Proceed?");
    expect(ctxText(runtime)).not.toContain("Tool not permitted");
  });

  it("falls back gracefully when there is no interactive handler", async () => {
    const runtime = new AgentRuntime(makeConfig(build));
    // no setAskUserHandler
    (runtime as unknown as { provider: unknown }).provider = scripted([askCall("x?"), "<answer>done</answer>"]);
    await runtime.run("do x");
    expect(ctxText(runtime)).toContain("No interactive user");
  });
});
