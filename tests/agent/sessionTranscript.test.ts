import { describe, expect, it } from "vitest";
import { Session } from "../../src/agent/Session.js";
import { formatSessionTranscript } from "../../src/agent/sessionTranscript.js";
import { BUILTIN_AGENTS } from "../../src/agent/AgentDefinition.js";

const build = BUILTIN_AGENTS.find((a) => a.id === "build")!;

function sampleSession(): Session {
  const s = new Session({ agent: build, model: "qwen-test", cwd: "/tmp", maxTokens: 8192 });
  s.ctx.add({ role: "system", content: "You are an AI agent." });
  s.ctx.add({ role: "user", content: "create hello.txt" });
  s.ctx.add({ role: "assistant", content: "<thought>writing it</thought>" });
  s.ctx.add({ role: "user", content: '[TOOL RESULT: write_file — OK] {"path":"hello.txt"}\nWrote 5 bytes' });
  s.ctx.add({ role: "assistant", content: "<answer>Created hello.txt.</answer>" });
  s.recordTool("write_file", { path: "hello.txt" });
  return s;
}

describe("formatSessionTranscript", () => {
  it("renders metadata and every message in order, labelled by role", () => {
    const md = formatSessionTranscript(sampleSession());
    expect(md).toContain("# ItsAAgent session transcript");
    expect(md).toContain("**Model:** `qwen-test`");
    expect(md).toContain("**Active agent:** `build`");
    // Every kind of message is present and labelled.
    expect(md).toContain("System prompt");
    expect(md).toContain("## 2. User");
    expect(md).toContain("Assistant");
    expect(md).toContain("Tool result");
    expect(md).toContain("create hello.txt");
    expect(md).toContain("Created hello.txt.");
    expect(md).toContain("Tool calls:** 1");
  });

  it("includes the agent path after a handoff", () => {
    const s = sampleSession();
    const plan = BUILTIN_AGENTS.find((a) => a.id === "plan")!;
    s.setAgent(plan);
    expect(formatSessionTranscript(s)).toContain("Agent path:");
  });

  it("handles an empty session", () => {
    const s = new Session({ model: "m", cwd: "/tmp", maxTokens: 8192 });
    expect(formatSessionTranscript(s)).toContain("empty session");
  });
});
