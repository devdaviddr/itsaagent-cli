import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../src/agent/promptBuilder.js";
import { getDefaultTools } from "../../src/tools/index.js";

const tools = getDefaultTools();

describe("buildSystemPrompt", () => {
  it("includes rule 9 referencing read_file start_line/end_line", () => {
    const prompt = buildSystemPrompt(tools, "/tmp");
    expect(prompt).toContain("9.");
    expect(prompt).toContain("wc -l");
    expect(prompt).toContain("start_line");
    expect(prompt).toContain("end_line");
  });

  it("includes rule 10 on failure recovery", () => {
    const prompt = buildSystemPrompt(tools, "/tmp");
    expect(prompt).toContain("10.");
    expect(prompt).toContain("fails twice");
    expect(prompt).toContain("Do not retry with minor variations");
  });

  it("appends an agent suffix after the rules block when provided", () => {
    const prompt = buildSystemPrompt(tools, "/tmp", "## Plan Agent\nread-only");
    expect(prompt).toContain("## Plan Agent");
    expect(prompt.indexOf("## Plan Agent")).toBeGreaterThan(prompt.indexOf("## Rules"));
  });

  it("omits the suffix section when none is provided", () => {
    const prompt = buildSystemPrompt(tools, "/tmp");
    expect(prompt).not.toContain("## Plan Agent");
  });
});
