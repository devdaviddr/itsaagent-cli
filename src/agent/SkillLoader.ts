import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Skill, SkillArg } from "../types.js";
import { splitFrontmatter, parseScalars, parseBool, stripQuotes } from "./frontmatter.js";

export const SKILLS_DIR = join(homedir(), ".config", "ai-cli", "skills");

/** Parse the `args:` block of skill frontmatter into structured SkillArg[]. */
function parseArgsBlock(raw: string): SkillArg[] {
  const lines = raw.split("\n");
  const args: SkillArg[] = [];
  let inArgs = false;
  let current: Partial<SkillArg> | null = null;

  const flush = () => {
    if (current && current.name) {
      args.push({ name: current.name, description: current.description ?? "", required: current.required ?? false });
    }
    current = null;
  };

  for (const line of lines) {
    if (/^args:\s*$/.test(line)) { inArgs = true; continue; }
    if (inArgs && /^\S/.test(line)) { flush(); inArgs = false; continue; } // dedent ends the block
    if (!inArgs) continue;

    const item = line.match(/^\s*-\s*name:\s*(.*)$/);
    if (item) { flush(); current = { name: stripQuotes(item[1].trim()) }; continue; }
    const field = line.match(/^\s+([A-Za-z0-9_]+):\s*(.*)$/);
    if (field && current) {
      const key = field[1];
      const val = field[2].trim();
      if (key === "description") current.description = stripQuotes(val);
      else if (key === "required") current.required = parseBool(val);
      else if (key === "name") current.name = stripQuotes(val);
    }
  }
  flush();
  return args;
}

/** Parse one skill file's contents. Returns null if invalid (no name). */
export function parseSkill(content: string): Skill | null {
  const { raw, body } = splitFrontmatter(content);
  if (raw === null) return null;
  const scalars = parseScalars(raw);
  if (!scalars.name) return null;
  return {
    name: scalars.name,
    description: scalars.description ?? "",
    args: parseArgsBlock(raw),
    body: body.trim(),
  };
}

/** Load all skills from a directory. Invalid files are skipped with a warning. */
export async function loadSkills(dir: string = SKILLS_DIR): Promise<Skill[]> {
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  const skills: Skill[] = [];
  for (const file of files) {
    try {
      const skill = parseSkill(await readFile(join(dir, file), "utf-8"));
      if (skill) skills.push(skill);
      else console.error(`Skipping invalid skill (missing name): ${file}`);
    } catch (err) {
      console.error(`Skipping unreadable skill ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return skills;
}

/** Replace {{arg}} placeholders in a skill body with provided values. */
export function interpolate(skill: Skill, values: Record<string, string>): string {
  return skill.body.replace(/\{\{(\w+)\}\}/g, (_m, key: string) =>
    key in values ? values[key] : `{{${key}}}`,
  );
}

/** Names of required args missing from `values`. */
export function missingRequiredArgs(skill: Skill, values: Record<string, string>): string[] {
  return skill.args.filter((a) => a.required && !(a.name in values)).map((a) => a.name);
}

/** Produce a ready-to-inject Skill with its body interpolated. */
export function resolveSkill(skill: Skill, values: Record<string, string>): Skill {
  return { ...skill, body: interpolate(skill, values) };
}

/**
 * Resolve named skills against the skills directory, validating required args.
 * Returns interpolated skills, or an error string for the CLI to print.
 */
export async function resolveSkillsByName(
  names: string[],
  values: Record<string, string>,
  dir: string = SKILLS_DIR,
): Promise<{ skills: Skill[]; error?: string }> {
  if (names.length === 0) return { skills: [] };
  const available = await loadSkills(dir);
  const byName = new Map(available.map((s) => [s.name, s]));
  const resolved: Skill[] = [];
  for (const name of names) {
    const skill = byName.get(name);
    if (!skill) {
      return { skills: [], error: `Unknown skill "${name}". Available: ${available.map((s) => s.name).join(", ") || "none"}` };
    }
    const missing = missingRequiredArgs(skill, values);
    if (missing.length > 0) {
      return { skills: [], error: `Skill "${name}" is missing required arg(s): ${missing.join(", ")}` };
    }
    resolved.push(resolveSkill(skill, values));
  }
  return { skills: resolved };
}
