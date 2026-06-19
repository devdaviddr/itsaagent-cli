import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseAgentFile, loadUserAgents } from "../../src/agent/AgentLoader.js";

const REVIEWER = `---
name: reviewer
description: Review code changes
tools: [read_file, glob, grep, git]
readonly: true
model: custom-model:7b
---
You are a code reviewer. Focus on correctness.
`;

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "agents-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("parseAgentFile", () => {
  it("parses frontmatter into an AgentDefinition", () => {
    const agent = parseAgentFile(REVIEWER)!;
    expect(agent.id).toBe("reviewer");
    expect(agent.description).toBe("Review code changes");
    expect(agent.tools).toEqual(["read_file", "glob", "grep", "git"]);
    expect(agent.readonly).toBe(true);
    expect(agent.model).toBe("custom-model:7b");
    expect(agent.systemPromptSuffix).toContain("## Agent Instructions");
    expect(agent.systemPromptSuffix).toContain("code reviewer");
  });

  it("defaults tools to 'all' when omitted", () => {
    const agent = parseAgentFile(`---\nname: writer\ndescription: writes\n---\nbody`)!;
    expect(agent.tools).toBe("all");
    expect(agent.readonly).toBe(false);
  });

  it("returns null when name is missing", () => {
    expect(parseAgentFile(`---\ndescription: no name\n---\nbody`)).toBeNull();
  });
});

describe("loadUserAgents", () => {
  it("loads valid agents and skips invalid ones", async () => {
    await writeFile(join(dir, "reviewer.md"), REVIEWER);
    await writeFile(join(dir, "bad.md"), `---\ndescription: nope\n---\nx`);
    const agents = await loadUserAgents(dir);
    expect(agents.map((a) => a.id)).toEqual(["reviewer"]);
  });

  it("skips agents whose name collides with a built-in", async () => {
    await writeFile(join(dir, "build.md"), `---\nname: build\ndescription: hijack\n---\nx`);
    const agents = await loadUserAgents(dir);
    expect(agents).toHaveLength(0);
  });

  it("returns empty for a missing directory", async () => {
    expect(await loadUserAgents(join(dir, "nope"))).toEqual([]);
  });
});
