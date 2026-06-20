import { describe, expect, it } from "vitest";
import { resolveModelProfile } from "../../src/providers/modelProfiles.js";
import { toAgentConfig, defaultConfig } from "../../src/cli/config.js";

describe("resolveModelProfile", () => {
  it("matches the qwen coder family", () => {
    expect(resolveModelProfile("qwen2.5-coder-7b-32k:latest").temperature).toBe(0.15);
  });

  it("matches gemma local fine-tunes", () => {
    expect(resolveModelProfile("gemma4-coder-32k:latest").temperature).toBe(0.15);
  });

  it("gives deepseek a slightly higher temperature", () => {
    expect(resolveModelProfile("deepseek-coder-v2:latest").temperature).toBe(0.2);
  });

  it("falls back to a safe default for unknown models", () => {
    const p = resolveModelProfile("some-unknown-model");
    expect(p.temperature).toBe(0.15);
    expect(p.numPredict).toBe(8192);
  });
});

describe("toAgentConfig — profile defaults + config overrides (Phase 6)", () => {
  it("uses the per-model profile by default", async () => {
    const c = await toAgentConfig(defaultConfig(), {});
    expect(c.provider.temperature).toBe(0.15);
    expect(c.provider.maxTokens).toBe(8192);
  });

  it("lets config override temperature / numPredict / stop", async () => {
    const conf = { ...defaultConfig(), temperature: 0.35, numPredict: 4096, stop: ["STOP"] };
    const c = await toAgentConfig(conf, {});
    expect(c.provider.temperature).toBe(0.35);
    expect(c.provider.maxTokens).toBe(4096);
    expect(c.provider.stop).toEqual(["STOP"]);
  });
});
