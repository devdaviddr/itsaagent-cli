import { describe, expect, it } from "vitest";
import { buildSystemPrompt, buildToolDescriptions } from "../../src/agent/promptBuilder.js";
import { getDefaultTools } from "../../src/tools/index.js";

const tools = getDefaultTools();

describe("buildToolDescriptions — compact flag", () => {
  it("full (default) includes Parameters and Required blocks", () => {
    const full = buildToolDescriptions(tools);
    expect(full).toContain("Parameters:");
    expect(full).toContain("Required:");
  });

  it("compact drops Parameters/Required, keeps name + one-line description", () => {
    const compact = buildToolDescriptions(tools, { compact: true });
    expect(compact).not.toContain("Parameters:");
    expect(compact).not.toContain("Required:");
    // Still names every tool.
    for (const t of tools) expect(compact).toContain(`### ${t.definition.name}`);
    // And keeps the descriptions.
    expect(compact).toContain(tools[0].definition.description);
  });
});

describe("buildSystemPrompt — compactTools only applies in native mode", () => {
  it("compactTools + nativeTools drops the Parameters block", () => {
    const p = buildSystemPrompt(tools, "/tmp", undefined, undefined, { compactTools: true, nativeTools: true });
    expect(p).not.toContain("Parameters:");
    expect(p).not.toContain("Required:");
  });

  it("compactTools WITHOUT nativeTools keeps full descriptions (text mode needs params)", () => {
    const p = buildSystemPrompt(tools, "/tmp", undefined, undefined, { compactTools: true, nativeTools: false });
    expect(p).toContain("Parameters:");
    expect(p).toContain("Required:");
  });

  it("nativeTools without compactTools keeps full descriptions", () => {
    const p = buildSystemPrompt(tools, "/tmp", undefined, undefined, { nativeTools: true });
    expect(p).toContain("Parameters:");
  });

  it("compact prompt is meaningfully shorter than the full one", () => {
    const full = buildSystemPrompt(tools, "/tmp", undefined, undefined, { nativeTools: true });
    const compact = buildSystemPrompt(tools, "/tmp", undefined, undefined, { nativeTools: true, compactTools: true });
    expect(compact.length).toBeLessThan(full.length);
  });
});
