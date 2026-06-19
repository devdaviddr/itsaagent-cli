import { describe, expect, it } from "vitest";
import { formatToolList, formatToolDetail, agentsPermitting } from "../../src/cli/commands/tools.js";
import { getDefaultTools } from "../../src/tools/index.js";

const tools = getDefaultTools();

describe("iaa tools", () => {
  it("lists every registered tool", () => {
    const out = formatToolList(tools);
    for (const t of tools) expect(out).toContain(t.definition.name);
    expect(out).toContain(`Built-in tools (${tools.length})`);
  });

  it("shows full parameter detail for one tool", () => {
    const editFile = tools.find((t) => t.definition.name === "edit_file")!;
    const out = formatToolDetail(editFile);
    expect(out).toContain("edit_file");
    expect(out).toContain("start_line");
    expect(out).toContain("(required)");
    expect(out).toContain("Permitted by:");
  });

  it("maps tools to the built-in agents that permit them", () => {
    // bash is a mutation tool: build (all) yes, plan (read-only) no, cli yes
    expect(agentsPermitting("bash")).toContain("build");
    expect(agentsPermitting("bash")).toContain("cli");
    expect(agentsPermitting("bash")).not.toContain("plan");
    // read_file: build yes, plan yes, cli no (not in cli's list)
    expect(agentsPermitting("read_file")).toContain("plan");
    expect(agentsPermitting("read_file")).not.toContain("cli");
  });
});
