import { describe, expect, it } from "vitest";
import { parseResponse, stableKey } from "../../src/agent/parser.js";

describe("parseResponse", () => {
  it("parses <tool_call> XML block", () => {
    const raw = `<thought>I should list files.</thought>\n<tool_call>\n{"name":"bash","args":{"command":"ls"}}\n</tool_call>`;
    const result = parseResponse(raw);
    expect(result.toolCall).toEqual({ name: "bash", args: { command: "ls" } });
    expect(result.thought).toBe("I should list files.");
    expect(result.answer).toBeUndefined();
    expect(result.isExplicitAnswer).toBe(false);
  });

  it("parses <answer> XML block and sets isExplicitAnswer", () => {
    const raw = `<thought>Done.</thought>\n<answer>\nThe result is 42.\n</answer>`;
    const result = parseResponse(raw);
    expect(result.answer).toBe("The result is 42.");
    expect(result.isExplicitAnswer).toBe(true);
    expect(result.toolCall).toBeUndefined();
  });

  it("extracts thought separately from tool call", () => {
    const raw = `<thought>Plan: run ls first.</thought>\n<tool_call>{"name":"glob","args":{"pattern":"**/*.ts"}}</tool_call>`;
    const result = parseResponse(raw);
    expect(result.thought).toBe("Plan: run ls first.");
    expect(result.toolCall?.name).toBe("glob");
  });

  it("falls back to legacy TOOL: format", () => {
    const raw = `I will run a command.\nTOOL: bash {"command":"pwd"}`;
    const result = parseResponse(raw);
    expect(result.toolCall).toEqual({ name: "bash", args: { command: "pwd" } });
  });

  it("falls back to bare JSON only when there is no <thought> block", () => {
    const raw = `{"name":"bash","args":{"command":"df -h"}}`;
    const result = parseResponse(raw);
    expect(result.toolCall).toEqual({ name: "bash", args: { command: "df -h" } });
  });

  it("does NOT use bare JSON fallback when JSON is inside <thought> content", () => {
    // JSON embedded in reasoning text must not be mistaken for a tool call
    const raw = `<thought>I found {"name":"fake","args":{}} in some data</thought>`;
    const result = parseResponse(raw);
    expect(result.toolCall).toBeUndefined();
    expect(result.thought).toBeTruthy();
  });

  it("picks up bare JSON emitted AFTER </thought> closing tag", () => {
    // qwen2.5-coder pattern: <thought>...</thought> then bare JSON on next line
    const raw = `<thought>I will list the desktop.</thought>\n{"name":"glob","args":{"pattern":"*","cwd":"~/Desktop"}}`;
    const result = parseResponse(raw);
    expect(result.toolCall).toEqual({ name: "glob", args: { pattern: "*", cwd: "~/Desktop" } });
    expect(result.thought).toBe("I will list the desktop.");
  });

  it("returns answer for fully unstructured text with isExplicitAnswer false", () => {
    const raw = "The answer is: hello world";
    const result = parseResponse(raw);
    expect(result.answer).toBe("The answer is: hello world");
    expect(result.isExplicitAnswer).toBe(false);
    expect(result.toolCall).toBeUndefined();
  });

  it("does not throw on malformed JSON in <tool_call>", () => {
    const raw = `<tool_call>{broken json}</tool_call>`;
    expect(() => parseResponse(raw)).not.toThrow();
  });

  it("handles missing args in <tool_call>", () => {
    const raw = `<tool_call>{"name":"bash"}</tool_call>`;
    const result = parseResponse(raw);
    expect(result.toolCall).toEqual({ name: "bash", args: {} });
  });

  it("accepts the OpenAI-style 'arguments' key in <tool_call>", () => {
    const raw = `<tool_call>{"name":"read_file","arguments":{"path":"a.ts"}}</tool_call>`;
    const result = parseResponse(raw);
    expect(result.toolCall).toEqual({ name: "read_file", args: { path: "a.ts" } });
  });

  it("accepts 'arguments' in a bare JSON tool call after a thought", () => {
    const raw = `thought: reading the file\naction:\n{"name":"read_file","arguments":{"path":"b.ts"}}`;
    const result = parseResponse(raw);
    expect(result.toolCall).toEqual({ name: "read_file", args: { path: "b.ts" } });
  });
});

describe("stableKey", () => {
  it("produces the same key regardless of argument key order", () => {
    const a = stableKey("bash", { b: 2, a: 1 });
    const b = stableKey("bash", { a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it("produces different keys for different tool names", () => {
    expect(stableKey("bash", { cmd: "ls" })).not.toBe(stableKey("glob", { cmd: "ls" }));
  });
});
