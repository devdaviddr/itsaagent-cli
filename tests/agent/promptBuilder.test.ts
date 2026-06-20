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

  it("tells the model to answer conversational input directly (rule 11)", () => {
    const prompt = buildSystemPrompt(tools, "/tmp");
    expect(prompt).toContain("11.");
    expect(prompt).toMatch(/greetings|small talk/i);
    expect(prompt).toContain("do NOT call a tool");
  });

  it("warns that commands run non-interactively (rule 12)", () => {
    const prompt = buildSystemPrompt(tools, "/tmp");
    expect(prompt).toContain("12.");
    expect(prompt).toMatch(/non-interactively|no stdin/i);
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

import { describe as describe2, it as it2, expect as expect2 } from "vitest";
import { buildSystemPrompt as bsp } from "../../src/agent/promptBuilder.js";
describe2("anti-hallucination rule", () => {
  it2("instructs the model never to claim success without a tool result", () => {
    const p = bsp([], "/tmp");
    expect2(p).toContain("NEVER claim");
    expect2(p).toMatch(/must emit a <tool_call>/i);
  });
});
