import { describe, expect, it } from "vitest";
import { formatToolResult } from "../../src/agent/AgentRuntime.js";
import { looksLikeMidTaskAnswer } from "../../src/agent/parser.js";
import { buildSystemPrompt } from "../../src/agent/promptBuilder.js";
import { getDefaultTools } from "../../src/tools/index.js";

const tools = getDefaultTools();

describe("formatToolResult — SUCCESS/FAILED framing (F-1.1)", () => {
  it("leads a successful result with OK", () => {
    const out = formatToolResult("write_file", { path: "x" }, { success: true, data: "Wrote 2 bytes" });
    expect(out).toContain("[TOOL RESULT: write_file — OK]");
    expect(out).toContain("Wrote 2 bytes");
  });

  it("leads a failed result with FAILED and a do-not-claim-success nudge", () => {
    const out = formatToolResult("edit_file", { path: "x" }, { success: false, data: "", error: "No such file" });
    expect(out).toContain("[TOOL RESULT: edit_file — FAILED]");
    expect(out).toContain("Error: No such file");
    expect(out).toMatch(/did NOT succeed/i);
    expect(out).toMatch(/do not claim it worked/i);
  });
});

describe("looksLikeMidTaskAnswer — premature-stop heuristic (F-1.3)", () => {
  it("flags status-shaped answers", () => {
    for (const s of [
      "Next, I will create the index.js file.",
      "Now I'll install the dependencies.",
      "I will now write the server code.",
      "Let me start by creating the folder.",
      "I'm going to set up the routes next.",
      "Proceeding to add the endpoint.",
      "The next step is to run the tests.",
    ]) {
      expect(looksLikeMidTaskAnswer(s)).toBe(true);
    }
  });

  it("does NOT flag genuine final answers", () => {
    for (const s of [
      "Created index.js with an Express server and a GET / route. The task is complete.",
      "The file now contains 'hello world'.",
      "Done — all three files were written and verified.",
      "The access code is 4271.",
      "",
    ]) {
      expect(looksLikeMidTaskAnswer(s)).toBe(false);
    }
  });
});

describe("few-shot exemplar in the system prompt (F-1.4)", () => {
  it("includes one worked trajectory by default", () => {
    const prompt = buildSystemPrompt(tools, "/tmp");
    expect(prompt).toContain("## Example (follow this shape)");
    expect(prompt).toContain("[TOOL RESULT: write_file — OK]");
  });

  it("omits the exemplar when fewShot is false (for A/B testing)", () => {
    const prompt = buildSystemPrompt(tools, "/tmp", undefined, undefined, { fewShot: false });
    expect(prompt).not.toContain("## Example (follow this shape)");
  });

  it("does not change the kept rule count (still ~7 numbered rules)", () => {
    const prompt = buildSystemPrompt(tools, "/tmp");
    const numbered = prompt.split("\n").filter((l) => /^\d+\. /.test(l));
    expect(numbered.length).toBeGreaterThanOrEqual(6);
    expect(numbered.length).toBeLessThanOrEqual(8);
  });
});

describe("native-tool-mode prompt branching (F-4.1)", () => {
  it("teaches the XML <tool_call> format by default (text mode)", () => {
    const prompt = buildSystemPrompt(tools, "/tmp");
    expect(prompt).toContain("<tool_call>");
    expect(prompt).toMatch(/wrapped in <tool_call> tags/);
  });

  it("drops the XML format and teaches direct calls when nativeTools is true", () => {
    const prompt = buildSystemPrompt(tools, "/tmp", undefined, undefined, { nativeTools: true });
    expect(prompt).not.toContain("<tool_call>"); // no contradictory XML instruction
    expect(prompt).toMatch(/function-calling|call a provided tool directly/i);
    expect(prompt).toContain("<answer>"); // final-answer format is still XML in both modes
    expect(prompt).toMatch(/MUST call a tool/); // rule 2 callVerb branched
  });
});
