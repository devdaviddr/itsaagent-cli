import { describe, expect, it } from "vitest";
import { buildBar, usageLevel, formatUsage, contextLine } from "../../src/cli/contextBar.js";

describe("contextBar helpers", () => {
  it("usageLevel maps thresholds: <60 low, 60-80 mid, >80 high", () => {
    expect(usageLevel(0)).toBe("low");
    expect(usageLevel(59)).toBe("low");
    expect(usageLevel(60)).toBe("mid");
    expect(usageLevel(80)).toBe("mid");
    expect(usageLevel(81)).toBe("high");
    expect(usageLevel(100)).toBe("high");
  });

  it("buildBar fills proportionally and keeps a fixed width", () => {
    expect(buildBar(0, 16)).toBe("░".repeat(16));
    expect(buildBar(100, 16)).toBe("█".repeat(16));
    const half = buildBar(50, 16);
    expect(half).toHaveLength(16);
    expect(half.startsWith("█")).toBe(true);
    expect(half.endsWith("░")).toBe(true);
  });

  it("formatUsage renders thousands separators and percentage", () => {
    expect(formatUsage(8432, 24576, 34)).toBe("8,432 / 24,576  34%");
  });

  it("contextLine combines bar and usage", () => {
    const line = contextLine(8432, 24576, 34);
    expect(line).toContain("ctx");
    expect(line).toContain("8,432 / 24,576  34%");
  });
});
