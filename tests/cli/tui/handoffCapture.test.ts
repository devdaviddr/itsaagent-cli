import { describe, expect, it } from "vitest";
import {
  conversationReducer,
  initialConversation,
  lastAnswer,
  type ConversationState,
  type Entry,
} from "../../../src/cli/tui/state/conversation.js";
import { AgentRuntime } from "../../../src/agent/AgentRuntime.js";
import { BUILTIN_AGENTS } from "../../../src/agent/AgentDefinition.js";
import type { AgentConfig } from "../../../src/types.js";

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

/** Provider that streams a fixed response then ends, so a run resolves after one step. */
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
function setProvider(rt: AgentRuntime, p: unknown): void {
  (rt as unknown as { provider: unknown }).provider = p;
  (rt as unknown as { toolUseMode: boolean | undefined }).toolUseMode = false; // force text-parser path
}

// ---------------------------------------------------------------------------
// lastAnswer — the plan-capture used when handing off (Tab in the TUI)
// ---------------------------------------------------------------------------
describe("lastAnswer (TUI plan capture)", () => {
  const mk = (entries: Entry[]): ConversationState => ({ ...initialConversation(), entries });

  it("returns '' when there is no answer entry", () => {
    expect(lastAnswer([])).toBe("");
    expect(lastAnswer(mk([{ id: 1, kind: "user", text: "hi" }] as Entry[]).entries)).toBe("");
  });

  it("returns the most recent answer, ignoring later non-answer entries", () => {
    const entries: Entry[] = [
      { id: 1, kind: "user", text: "plan a thing" },
      { id: 2, kind: "answer", text: "FIRST PLAN" },
      { id: 3, kind: "answer", text: "REVISED PLAN" },
      { id: 4, kind: "notice", text: "press Tab" },
    ];
    expect(lastAnswer(entries)).toBe("REVISED PLAN");
  });
});

// ---------------------------------------------------------------------------
// /clear semantics — reset wipes the visible transcript
// ---------------------------------------------------------------------------
describe("/clear wipes the transcript (reset)", () => {
  it("empties entries and restores follow/scroll state", () => {
    let s = initialConversation();
    s = conversationReducer(s, { type: "user", text: "one" });
    s = conversationReducer(s, { type: "answer", text: "two" });
    s = conversationReducer(s, { type: "scrollUp", lines: 5 });
    expect(s.entries.length).toBeGreaterThan(0);

    s = conversationReducer(s, { type: "reset" });
    expect(s.entries).toEqual([]);
    expect(s.following).toBe(true);
    expect(s.scrollOffset).toBe(0);
    expect(s.live).toBe("");
  });
});

// ---------------------------------------------------------------------------
// The whole TUI handoff wiring: capture the plan from the reducer, then hand
// it to build — exactly what pressing Tab does — without rendering tuir.
// ---------------------------------------------------------------------------
describe("plan → build handoff wiring (capture + handoff)", () => {
  it("captures the plan answer and seeds build's context with it", async () => {
    const rt = new AgentRuntime(makeConfig(plan));
    setProvider(rt, scripted("<answer>PLAN: create app.js that logs hi</answer>"));

    // Mirror useAgentEvents: feed the runtime's answer into the conversation reducer.
    let conv = initialConversation();
    rt.on("answer", ({ text }) => {
      conv = conversationReducer(conv, { type: "answer", text });
    });

    conv = conversationReducer(conv, { type: "user", text: "plan it" });
    await rt.run("plan it");

    // The TUI scrapes the plan from the transcript via lastAnswer().
    const planText = lastAnswer(conv.entries);
    expect(planText).toBe("PLAN: create app.js that logs hi");

    // Pressing Tab hands that captured text to build.
    setProvider(rt, scripted("<answer>done</answer>"));
    await rt.handoffToBuild(build, planText);

    expect(rt.agentId).toBe("build");
    const handed = rt.session.transitions.some((t) => t.from === "plan" && t.to === "build");
    expect(handed).toBe(true);

    // Build's context must contain the captured plan text.
    const ctx = rt.session.ctx.get().map((m) => m.content).join("\n");
    expect(ctx).toContain("PLAN: create app.js that logs hi");
  });
});
