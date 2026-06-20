import { describe, expect, it } from "vitest";
import { filterItems, clampIndex, type SelectItem } from "../../../src/cli/tui/components/select.js";

const items: SelectItem[] = [
  { value: "build", label: "build", desc: "full access" },
  { value: "plan", label: "plan", desc: "read-only planner" },
  { value: "cli", label: "cli", desc: "shell and infra" },
];

describe("select filtering", () => {
  it("returns all items for an empty query", () => {
    expect(filterItems(items, "")).toHaveLength(3);
    expect(filterItems(items, "   ")).toHaveLength(3);
  });

  it("matches on label", () => {
    expect(filterItems(items, "pl").map((i) => i.value)).toEqual(["plan"]);
  });

  it("matches on description, case-insensitively", () => {
    expect(filterItems(items, "SHELL").map((i) => i.value)).toEqual(["cli"]);
    expect(filterItems(items, "read-only").map((i) => i.value)).toEqual(["plan"]);
  });

  it("returns nothing when no item matches", () => {
    expect(filterItems(items, "zzz")).toEqual([]);
  });
});

describe("clampIndex", () => {
  it("keeps the index within range", () => {
    expect(clampIndex(-2, 3)).toBe(0);
    expect(clampIndex(5, 3)).toBe(2);
    expect(clampIndex(1, 3)).toBe(1);
  });

  it("returns 0 for an empty list", () => {
    expect(clampIndex(4, 0)).toBe(0);
  });
});
