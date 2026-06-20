import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findProjectContext, formatProjectContext } from "../../src/agent/projectContext.js";
import { buildSystemPrompt } from "../../src/agent/promptBuilder.js";
import { AgentRuntime } from "../../src/agent/AgentRuntime.js";
import { BUILTIN_AGENTS } from "../../src/agent/AgentDefinition.js";
import { setSessionCwd, resetSessionCwd } from "../../src/tools/session.js";
import type { AgentConfig } from "../../src/types.js";

const build = BUILTIN_AGENTS.find((a) => a.id === "build")!;
let root: string;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  resetSessionCwd();
});

describe("findProjectContext", () => {
  it("finds AGENTS.md in the current directory", () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "iaa-pc-")));
    writeFileSync(join(root, "AGENTS.md"), "# Build with pnpm");
    const ctx = findProjectContext(root);
    expect(ctx?.content).toContain("Build with pnpm");
    expect(ctx?.truncated).toBe(false);
  });

  it("walks UP to the nearest ancestor AGENTS.md", () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "iaa-pc-")));
    writeFileSync(join(root, "AGENTS.md"), "root conventions");
    const deep = join(root, "src", "tools");
    mkdirSync(deep, { recursive: true });
    expect(findProjectContext(deep)?.content).toContain("root conventions");
  });

  it("prefers the NEAREST file over an ancestor", () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "iaa-pc-")));
    writeFileSync(join(root, "AGENTS.md"), "root");
    const sub = join(root, "pkg");
    mkdirSync(sub);
    writeFileSync(join(sub, "AGENTS.md"), "package-specific");
    expect(findProjectContext(sub)?.content).toBe("package-specific");
  });

  it("returns null when there is no AGENTS.md", () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "iaa-pc-")));
    expect(findProjectContext(root)).toBeNull();
  });

  it("caps oversized files and flags truncation", () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "iaa-pc-")));
    writeFileSync(join(root, "AGENTS.md"), "x".repeat(20000));
    const ctx = findProjectContext(root, 5000);
    expect(ctx?.content.length).toBe(5000);
    expect(ctx?.truncated).toBe(true);
  });
});

describe("buildSystemPrompt project-context block", () => {
  it("includes the formatted block when provided", () => {
    const block = formatProjectContext({ path: "/p/AGENTS.md", content: "use pnpm", truncated: false });
    const prompt = buildSystemPrompt([], "/tmp", undefined, undefined, { projectContext: block });
    expect(prompt).toContain("## Project context (from /p/AGENTS.md)");
    expect(prompt).toContain("use pnpm");
  });
});

function scripted(rt: AgentRuntime): void {
  (rt as unknown as { provider: unknown }).provider = {
    async *stream() {
      for (const c of "<answer>ok</answer>") yield { delta: c, done: false };
      yield { delta: "", done: true };
    },
  };
  (rt as unknown as { toolUseMode: boolean }).toolUseMode = false;
}
function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    provider: { type: "ollama", baseUrl: "http://x", model: "test", temperature: 0.1, maxTokens: 64 },
    verbose: false,
    maxSteps: 2,
    maxContextTokens: 8192,
    agent: build,
    ...overrides,
  };
}

describe("AgentRuntime loads AGENTS.md from the session cwd", () => {
  it("injects project context into the system prompt", async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "iaa-pc-")));
    writeFileSync(join(root, "AGENTS.md"), "ALWAYS run pnpm test before finishing.");
    setSessionCwd(root);
    const rt = new AgentRuntime(makeConfig());
    scripted(rt);
    await rt.run("hi");
    const system = rt.session.ctx.get().find((m) => m.role === "system");
    expect(system?.content).toContain("ALWAYS run pnpm test");
  });

  it("does not inject when projectContext is disabled", async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "iaa-pc-")));
    writeFileSync(join(root, "AGENTS.md"), "secret marker phrase");
    setSessionCwd(root);
    const rt = new AgentRuntime(makeConfig({ projectContext: false }));
    scripted(rt);
    await rt.run("hi");
    const system = rt.session.ctx.get().find((m) => m.role === "system");
    expect(system?.content).not.toContain("secret marker phrase");
  });
});
