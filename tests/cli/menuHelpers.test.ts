import { describe, expect, it } from "vitest";
import {
  statusHeader,
  agentPickerOptions,
  handleCancel,
  applyModelSelection,
  BACK_VALUE,
} from "../../src/cli/menuHelpers.js";
import { defaultConfig } from "../../src/cli/config.js";
import { BUILTIN_AGENTS } from "../../src/agent/AgentDefinition.js";
import type { AgentDefinition } from "../../src/agent/AgentDefinition.js";

describe("statusHeader (M-05)", () => {
  it("shows agent, model, provider and host", () => {
    const h = statusHeader({ agentId: "build", model: "m1", providerType: "ollama", host: "http://x" });
    expect(h).toContain("build");
    expect(h).toContain("m1");
    expect(h).toContain("ollama");
    expect(h).toContain("http://x");
  });

  it("marks native tool use with ⚡", () => {
    const h = statusHeader({ agentId: "build", model: "m1", providerType: "ollama", host: "x", nativeTools: true });
    expect(h).toContain("⚡");
  });

  it("shows an unreachable warning when offline", () => {
    const h = statusHeader({ agentId: "build", model: "m1", providerType: "ollama", host: "x", online: false });
    expect(h).toMatch(/unreachable/);
  });
});

describe("agentPickerOptions (M-02)", () => {
  const custom: AgentDefinition = { id: "reviewer", name: "reviewer", description: "review", tools: ["read_file"], readonly: true };
  const all = [...BUILTIN_AGENTS, custom];
  const isBuiltin = (id: string) => BUILTIN_AGENTS.some((a) => a.id === id);

  it("lists built-ins before custom agents and tags custom", () => {
    const opts = agentPickerOptions(all, isBuiltin);
    const ids = opts.map((o) => o.value);
    expect(ids.indexOf("build")).toBeLessThan(ids.indexOf("reviewer"));
    expect(opts.find((o) => o.value === "reviewer")!.label).toContain("[custom]");
  });

  it("appends a Back option", () => {
    const opts = agentPickerOptions(all, isBuiltin);
    expect(opts[opts.length - 1].value).toBe(BACK_VALUE);
  });
});

describe("handleCancel (M-04)", () => {
  it("quits at the top level and goes back in sub-menus", () => {
    expect(handleCancel(0)).toBe("quit");
    expect(handleCancel(1)).toBe("back");
    expect(handleCancel(2)).toBe("back");
  });
});

describe("applyModelSelection (M-06)", () => {
  it("sets the model and leaves the rest of the config intact", () => {
    const conf = defaultConfig();
    const updated = applyModelSelection(conf, "new-model:7b");
    expect(updated.model).toBe("new-model:7b");
    expect(updated.host).toBe(conf.host);
    expect(updated.maxSteps).toBe(conf.maxSteps);
  });
});
