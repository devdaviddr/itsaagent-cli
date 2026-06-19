import { resolveSkillsByName } from "../agent/SkillLoader.js";
import type { Skill } from "../types.js";

/** Parse `name=value` pairs from --skill-arg into a values map. */
export function parseSkillArgs(pairs: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const p of pairs) {
    const i = p.indexOf("=");
    if (i > 0) values[p.slice(0, i)] = p.slice(i + 1);
  }
  return values;
}

/** Resolve skills selected via --skill / --skill-arg flags. */
export async function resolveCliSkills(
  names: string[],
  argPairs: string[],
  extraValues: Record<string, string> = {},
): Promise<{ skills: Skill[]; error?: string }> {
  const values = { ...parseSkillArgs(argPairs), ...extraValues };
  return resolveSkillsByName(names, values);
}
