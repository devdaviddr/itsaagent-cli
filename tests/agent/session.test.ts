import { describe, expect, it } from "vitest";
import { Session } from "../../src/agent/Session.js";
import { BUILTIN_AGENTS } from "../../src/agent/AgentDefinition.js";

const build = BUILTIN_AGENTS.find((a) => a.id === "build")!;
const plan = BUILTIN_AGENTS.find((a) => a.id === "plan")!;

function makeSession() {
  return new Session({ agent: plan, model: "m", cwd: "/tmp", maxTokens: 8192 });
}

describe("Session", () => {
  it("owns context: add, get, and report usage", () => {
    const s = makeSession();
    s.ctx.add({ role: "system", content: "sys" });
    s.ctx.add({ role: "user", content: "hello" });
    expect(s.ctx.get().map((m) => m.role)).toEqual(["system", "user"]);
    expect(s.ctx.usage().max).toBe(8192);
  });

  it("switching agent records the transition WITHOUT clearing context", () => {
    const s = makeSession();
    s.ctx.add({ role: "system", content: "sys" });
    s.ctx.add({ role: "user", content: "do x" });
    expect(s.agentId).toBe("plan");

    s.setAgent(build);

    expect(s.agentId).toBe("build");
    // context is untouched by the agent switch
    expect(s.ctx.get().map((m) => m.role)).toEqual(["system", "user"]);
    expect(s.transitions).toEqual([{ from: "plan", to: "build", at: expect.any(Number) }]);
  });

  it("records a structured tool history", () => {
    const s = makeSession();
    s.recordTool("read_file", { path: "a.ts" });
    s.recordTool("bash", { command: "ls" });
    expect(s.toolHistory).toEqual([
      { name: "read_file", args: { path: "a.ts" } },
      { name: "bash", args: { command: "ls" } },
    ]);
  });

  it("builds a deterministic compact summary from the tool history", () => {
    const s = makeSession();
    s.recordTool("read_file", { path: "src/a.ts" });
    s.recordTool("read_file", { path: "src/a.ts" }); // de-duped
    s.recordTool("read_file", { path: "src/b.ts" });
    s.recordTool("grep", { pattern: "useFoo" });
    s.recordTool("bash", { command: "npm test" });
    s.recordTool("write_file", { path: "src/c.ts" });

    const summary = s.examinedSummary();
    expect(summary).toContain("Files read: src/a.ts, src/b.ts");
    expect(summary).toContain("Searched: useFoo");
    expect(summary).toContain("Commands run: npm test");
    expect(summary).toContain("Files written/edited: src/c.ts");
  });

  it("summarises an empty history without throwing", () => {
    expect(makeSession().examinedSummary()).toContain("nothing was examined");
  });

  it("generates a unique id and carries model/cwd/title", () => {
    const a = makeSession();
    const b = makeSession();
    expect(a.id).not.toBe(b.id);
    expect(a.model).toBe("m");
    expect(a.cwd).toBe("/tmp");
    expect(a.title).toBeTruthy();
  });
});
