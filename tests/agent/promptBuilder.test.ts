import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../src/agent/promptBuilder.js";
import { getDefaultTools } from "../../src/tools/index.js";

const tools = getDefaultTools();

describe("buildSystemPrompt — slim rules (F-05)", () => {
  const prompt = buildSystemPrompt(tools, "/tmp");

  it("is consolidated to at most ~8 numbered rules", () => {
    const numbered = prompt.split("\n").filter((l) => /^\d+\. /.test(l));
    expect(numbered.length).toBeGreaterThanOrEqual(6);
    expect(numbered.length).toBeLessThanOrEqual(8);
  });

  it("keeps the one-tool-per-response + JSON format rule", () => {
    expect(prompt).toMatch(/ONE tool call per response/i);
    expect(prompt).toContain("<tool_call>");
    expect(prompt).toContain('"name"');
    expect(prompt).toContain('"args"');
  });

  it("keeps the anti-hallucination rule (no success without a tool result)", () => {
    expect(prompt).toContain("NEVER claim");
    expect(prompt).toMatch(/must emit a <tool_call>/i);
    expect(prompt).toContain("[TOOL RESULT]");
  });

  it("keeps the write_file file-creation guidance", () => {
    expect(prompt).toMatch(/write_file/);
    expect(prompt).toMatch(/never read_file a path you mean to create/i);
  });

  it("keeps the environment rule (real home dir, no placeholders, cwd persists)", () => {
    expect(prompt).toContain("/tmp");
    expect(prompt).toMatch(/NEVER invent placeholder paths/i);
    expect(prompt).toMatch(/cwd persists across bash calls/i);
  });

  it("keeps the OS-appropriate, non-interactive rule", () => {
    expect(prompt).toMatch(/OS-appropriate/i);
    expect(prompt).toMatch(/non-interactive/i);
    expect(prompt).toMatch(/vm_stat|sysctl/);
  });

  it("keeps the ask_user clarification rule", () => {
    expect(prompt).toContain("ask_user");
    expect(prompt).toMatch(/ambiguous/i);
  });

  it("keeps the no-repeat / stop-after-two-failures rule", () => {
    expect(prompt).toMatch(/Never repeat the same tool call/i);
    expect(prompt).toMatch(/fails twice/i);
  });

  it("keeps the conversational-shortcut + large-file + verify guidance", () => {
    expect(prompt).toMatch(/greetings|small talk/i);
    expect(prompt).toContain("wc -l");
    expect(prompt).toMatch(/start_line\/end_line/);
  });

  it("appends an agent suffix after the rules block when provided", () => {
    const p = buildSystemPrompt(tools, "/tmp", "## Plan Agent\nread-only");
    expect(p).toContain("## Plan Agent");
    expect(p.indexOf("## Plan Agent")).toBeGreaterThan(p.indexOf("## Rules"));
  });

  it("omits the suffix section when none is provided", () => {
    expect(prompt).not.toContain("## Plan Agent");
  });
});
