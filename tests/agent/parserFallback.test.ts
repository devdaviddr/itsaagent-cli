import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRuntime } from "../../src/agent/AgentRuntime.js";
import { BUILTIN_AGENTS } from "../../src/agent/AgentDefinition.js";
import type { AgentConfig } from "../../src/types.js";
import { setSessionCwd, resetSessionCwd } from "../../src/tools/session.js";

const build = BUILTIN_AGENTS.find((a) => a.id === "build")!;

function makeConfig(): AgentConfig {
  return {
    provider: { type: "ollama", baseUrl: "http://localhost:11434", model: "test", temperature: 0.1, maxTokens: 512 },
    verbose: false,
    maxSteps: 5,
    maxContextTokens: 8192,
    agent: build,
  };
}

/**
 * A provider that streams whatever script it is given for each step, simulating
 * a NON-tool-capable model: it emits the tool call as `<tool_call>` *text*, with
 * no native `tool_calls`. This forces the runtime down the parseResponse() path.
 */
function scriptedSteps(steps: string[]) {
  let i = 0;
  return {
    async *stream() {
      const text = steps[Math.min(i, steps.length - 1)];
      i++;
      for (const c of text) yield { delta: c, done: false };
      yield { delta: "", done: true };
    },
    checkHealth: async () => true,
    listModels: async () => [],
    // No supportsTools → detectToolUse() resolves false → text-parser path.
  };
}

describe("text-parser fallback (non-tool model path)", () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    resetSessionCwd();
  });

  it("parses a <tool_call> emitted as text and actually executes it", async () => {
    dir = mkdtempSync(join(tmpdir(), "iaa-parser-"));
    setSessionCwd(dir);

    const rt = new AgentRuntime(makeConfig());
    (rt as unknown as { provider: unknown }).provider = scriptedSteps([
      // Step 1: a tool call expressed as text (what a non-tool model emits).
      '<thought>I will create the file.</thought>\n<tool_call>\n{"name": "write_file", "args": {"path": "parsed.txt", "content": "from the parser"}}\n</tool_call>',
      // Step 2: after the tool result, a final answer.
      "<answer>Created parsed.txt.</answer>",
    ]);

    const calls: string[] = [];
    rt.on("tool:call", ({ name }) => calls.push(name));

    const answer = await rt.run("create the file");

    // The runtime detected no native tools and parsed the text tool call…
    expect(rt.session).toBeDefined();
    expect(calls).toContain("write_file");
    // …and actually executed it on disk.
    expect(existsSync(join(dir, "parsed.txt"))).toBe(true);
    expect(readFileSync(join(dir, "parsed.txt"), "utf-8")).toBe("from the parser");
    expect(answer).toContain("Created parsed.txt");
  });
});
