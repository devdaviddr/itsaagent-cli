import { describe, expect, it } from "vitest";
import { parseChatInput, CHAT_HELP } from "../../src/cli/chatCommands.js";

describe("parseChatInput (M-03)", () => {
  it("treats non-slash input as a message", () => {
    expect(parseChatInput("hello there")).toEqual({ kind: "message", text: "hello there" });
  });

  it("parses /exit and /quit", () => {
    expect(parseChatInput("/exit").kind).toBe("exit");
    expect(parseChatInput("/quit").kind).toBe("exit");
  });

  it("parses /clear, /help, /agents", () => {
    expect(parseChatInput("/clear").kind).toBe("clear");
    expect(parseChatInput("/help").kind).toBe("help");
    expect(parseChatInput("/agents").kind).toBe("agents");
  });

  it("parses /agent <name> and /model <name>", () => {
    expect(parseChatInput("/agent plan")).toEqual({ kind: "agent", name: "plan" });
    expect(parseChatInput("/model mistral:7b")).toEqual({ kind: "model", name: "mistral:7b" });
  });

  it("flags unknown slash commands", () => {
    expect(parseChatInput("/frobnicate")).toEqual({ kind: "unknown", cmd: "frobnicate" });
  });

  it("help text lists the commands", () => {
    expect(CHAT_HELP).toContain("/agent");
    expect(CHAT_HELP).toContain("/model");
    expect(CHAT_HELP).toContain("/exit");
  });
});
