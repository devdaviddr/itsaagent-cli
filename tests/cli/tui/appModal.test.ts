import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { render } from "ink-testing-library";
import { App } from "../../../src/cli/tui/App.js";
import { AgentRuntime } from "../../../src/agent/AgentRuntime.js";
import type { AgentConfig } from "../../../src/types.js";

const DOWN = "[B";
const ENTER = "\r";

function makeRuntime(): AgentRuntime {
  const config: AgentConfig = {
    provider: { type: "ollama", baseUrl: "http://localhost:11434", model: "qwen2.5-coder:7b", temperature: 0.1, maxTokens: 512 },
    verbose: false,
    maxSteps: 5,
    maxContextTokens: 4096,
  };
  const rt = new AgentRuntime(config);
  (rt as unknown as { provider: unknown }).provider = {
    async *stream() {
      yield { delta: "", done: true };
    },
    checkHealth: async () => true,
    listModels: async () => [{ name: "qwen2.5-coder:7b" }, { name: "gemma4:12b" }],
    supportsTools: async () => false,
  };
  return rt;
}

function makeProps() {
  return {
    runtime: makeRuntime(),
    agents: [
      { id: "build", description: "full access", builtin: true },
      { id: "plan", description: "read-only", builtin: true },
    ],
    resolveAgent: () => undefined,
    providerOk: true,
    themeName: "default",
  };
}

const tick = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("App command palette → modal", () => {
  it("typing /model and Enter opens the Select model modal (not the list)", async () => {
    const { lastFrame, stdin, unmount } = render(createElement(App, makeProps()));
    await tick();
    stdin.write("/model");
    await tick();
    stdin.write(ENTER);
    await tick(80);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Select model");
    expect(frame).not.toContain("Models:");
    unmount();
  });

  it("navigating with arrows to /model and Enter opens the modal", async () => {
    const { lastFrame, stdin, unmount } = render(createElement(App, makeProps()));
    await tick();
    stdin.write("/");
    await tick();
    // palette order: help(0) → agent(1) → model(2)
    stdin.write(DOWN);
    await tick();
    stdin.write(DOWN);
    await tick();
    stdin.write(ENTER);
    await tick(80);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Select model");
    expect(frame).not.toContain("Models:");
    unmount();
  });

  it("/agent opens the Select agent modal", async () => {
    const { lastFrame, stdin, unmount } = render(createElement(App, makeProps()));
    await tick();
    stdin.write("/agent");
    await tick();
    stdin.write(ENTER);
    await tick(60);
    expect(lastFrame() ?? "").toContain("Select agent");
    unmount();
  });

  it("/help and /tools open read-only info modals", async () => {
    const { lastFrame, stdin, unmount } = render(createElement(App, makeProps()));
    await tick();
    stdin.write("/help");
    await tick();
    stdin.write(ENTER);
    await tick(60);
    const helpFrame = lastFrame() ?? "";
    expect(helpFrame).toContain("Help");
    expect(helpFrame).toContain("Slash commands");
    // Info modal closes on Enter (no selection to make).
    stdin.write(ENTER);
    await tick(60);
    expect(lastFrame() ?? "").not.toContain("Slash commands");

    stdin.write("/tools");
    await tick();
    stdin.write(ENTER);
    await tick(60);
    const toolsFrame = lastFrame() ?? "";
    expect(toolsFrame).toContain("Tools");
    expect(toolsFrame).toContain("bash");
    unmount();
  });

  it("/theme opens the Select theme modal, and Esc closes it", async () => {
    const { lastFrame, stdin, unmount } = render(createElement(App, makeProps()));
    await tick();
    stdin.write("/theme");
    await tick();
    stdin.write(ENTER);
    await tick(60);
    expect(lastFrame() ?? "").toContain("Select theme");
    stdin.write(""); // esc
    await tick(60);
    expect(lastFrame() ?? "").not.toContain("Select theme");
    unmount();
  });
});
