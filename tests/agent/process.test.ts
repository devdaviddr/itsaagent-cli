import { describe, expect, it } from "vitest";
import {
  GUIDED_PROCESS,
  BUILTIN_PROCESSES,
  getProcess,
  nextStageIndex,
  stageAgent,
} from "../../src/agent/Process.js";
import { parseChatInput } from "../../src/cli/chatCommands.js";

describe("guided process definition", () => {
  it("is plan → build", () => {
    expect(GUIDED_PROCESS.id).toBe("guided");
    expect(GUIDED_PROCESS.stages.map((s) => s.agent)).toEqual(["plan", "build"]);
  });

  it("is registered and lookupable", () => {
    expect(getProcess("guided")).toBe(GUIDED_PROCESS);
    expect(getProcess("nope")).toBeUndefined();
    expect(BUILTIN_PROCESSES).toContain(GUIDED_PROCESS);
  });
});

describe("process stage advancement (pure state machine)", () => {
  it("advances to the next stage, then stops at the end", () => {
    expect(nextStageIndex(GUIDED_PROCESS, 0)).toBe(1);
    expect(nextStageIndex(GUIDED_PROCESS, 1)).toBeNull();
  });

  it("maps a stage index to its agent (clamped to range)", () => {
    expect(stageAgent(GUIDED_PROCESS, 0)).toBe("plan");
    expect(stageAgent(GUIDED_PROCESS, 1)).toBe("build");
    expect(stageAgent(GUIDED_PROCESS, 99)).toBe("build");
    expect(stageAgent(GUIDED_PROCESS, -5)).toBe("plan");
  });
});

describe("/guided command parsing", () => {
  it("parses the task argument", () => {
    expect(parseChatInput("/guided build an express api")).toEqual({
      kind: "guided",
      task: "build an express api",
    });
    expect(parseChatInput("/guided")).toEqual({ kind: "guided", task: "" });
  });
});
