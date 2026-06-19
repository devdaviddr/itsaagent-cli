import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseSkill,
  loadSkills,
  interpolate,
  missingRequiredArgs,
  resolveSkillsByName,
} from "../../src/agent/SkillLoader.js";
import { buildSystemPrompt } from "../../src/agent/promptBuilder.js";
import { getDefaultTools } from "../../src/tools/index.js";
import type { Skill } from "../../src/types.js";

const SKILL_MD = `---
name: refactor
description: Refactor TypeScript
args:
  - name: target
    description: File to refactor
    required: true
---
Refactor the file. Target: {{target}}
`;

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "skills-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("parseSkill", () => {
  it("parses frontmatter, args, and body", () => {
    const skill = parseSkill(SKILL_MD)!;
    expect(skill.name).toBe("refactor");
    expect(skill.description).toBe("Refactor TypeScript");
    expect(skill.args).toEqual([{ name: "target", description: "File to refactor", required: true }]);
    expect(skill.body).toContain("Target: {{target}}");
  });

  it("returns null for missing frontmatter name", () => {
    expect(parseSkill("---\ndescription: no name\n---\nbody")).toBeNull();
  });

  it("returns null when there is no frontmatter at all", () => {
    expect(parseSkill("just a plain body")).toBeNull();
  });
});

describe("loadSkills", () => {
  it("loads valid skills and skips invalid ones", async () => {
    await writeFile(join(dir, "refactor.md"), SKILL_MD);
    await writeFile(join(dir, "broken.md"), "---\ndescription: nope\n---\nbody"); // no name
    const skills = await loadSkills(dir);
    expect(skills.map((s) => s.name)).toEqual(["refactor"]);
  });

  it("returns empty array for a missing directory", async () => {
    expect(await loadSkills(join(dir, "does-not-exist"))).toEqual([]);
  });
});

describe("interpolate / required args", () => {
  const skill = parseSkill(SKILL_MD)!;

  it("substitutes {{arg}} placeholders", () => {
    expect(interpolate(skill, { target: "src/x.ts" })).toContain("Target: src/x.ts");
  });

  it("reports missing required args", () => {
    expect(missingRequiredArgs(skill, {})).toEqual(["target"]);
    expect(missingRequiredArgs(skill, { target: "x" })).toEqual([]);
  });
});

describe("resolveSkillsByName", () => {
  it("errors when a required arg is missing", async () => {
    await writeFile(join(dir, "refactor.md"), SKILL_MD);
    const { error } = await resolveSkillsByName(["refactor"], {}, dir);
    expect(error).toMatch(/missing required arg/);
  });

  it("errors on an unknown skill name", async () => {
    const { error } = await resolveSkillsByName(["ghost"], {}, dir);
    expect(error).toMatch(/Unknown skill/);
  });

  it("resolves and interpolates when args are provided", async () => {
    await writeFile(join(dir, "refactor.md"), SKILL_MD);
    const { skills, error } = await resolveSkillsByName(["refactor"], { target: "a.ts" }, dir);
    expect(error).toBeUndefined();
    expect(skills[0].body).toContain("Target: a.ts");
  });
});

describe("buildSystemPrompt with skills", () => {
  const skill: Skill = { name: "refactor", description: "", args: [], body: "Be strict about types." };

  it("injects skill body under an Active Skill heading", () => {
    const prompt = buildSystemPrompt(getDefaultTools(), "/tmp", undefined, [skill]);
    expect(prompt).toContain("## Active Skill: refactor");
    expect(prompt).toContain("Be strict about types.");
  });

  it("composes multiple skills in order", () => {
    const s2: Skill = { name: "review", description: "", args: [], body: "Find bugs." };
    const prompt = buildSystemPrompt(getDefaultTools(), "/tmp", undefined, [skill, s2]);
    expect(prompt.indexOf("refactor")).toBeLessThan(prompt.indexOf("review"));
    expect(prompt).toContain("Find bugs.");
  });

  it("omits the skill section when none are active", () => {
    const prompt = buildSystemPrompt(getDefaultTools(), "/tmp");
    expect(prompt).not.toContain("## Active Skill");
  });
});
