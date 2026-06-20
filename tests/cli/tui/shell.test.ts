import { describe, expect, it } from "vitest";
import { headerText, statusHint } from "../../../src/cli/tui/layout/chrome.js";
import { selectRenderMode } from "../../../src/cli/output.js";
import { conversationReducer, initialConversation } from "../../../src/cli/tui/state/conversation.js";

describe("chrome text", () => {
  it("formats the header", () => {
    expect(headerText("build", "qwen2.5-coder")).toBe("ItsAAgent · build · qwen2.5-coder");
  });

  it("selects a hint per mode", () => {
    expect(statusHint("running")).toContain("Esc to cancel");
    expect(statusHint("scrolled")).toContain("latest");
    expect(statusHint("idle")).toContain("/help");
    expect(statusHint("error")).toContain("continue");
  });
});

describe("render-mode routing", () => {
  it("non-TTY always falls back to the plain renderer", () => {
    expect(selectRenderMode({ isTTY: false, interactive: true })).toBe("plain");
    expect(selectRenderMode({ isTTY: false, interactive: false })).toBe("plain");
  });

  it("a TTY uses the persistent TUI only when opted in", () => {
    expect(selectRenderMode({ isTTY: true, interactive: true })).toBe("interactive");
    expect(selectRenderMode({ isTTY: true, interactive: false })).toBe("oneshot");
  });
});

describe("turn submission preserves prior turns", () => {
  it("a second user message appends without clearing the log", () => {
    let state = initialConversation();
    for (const action of [
      { type: "user" as const, text: "first" },
      { type: "answer" as const, text: "ok" },
      { type: "user" as const, text: "second" },
    ]) {
      state = conversationReducer(state, action);
    }
    const userTexts = state.entries.filter((e) => e.kind === "user").map((e) => (e as { text: string }).text);
    expect(userTexts).toEqual(["first", "second"]);
    expect(state.entries).toHaveLength(3);
  });
});
