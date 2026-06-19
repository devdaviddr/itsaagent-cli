import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { BUILTIN_AGENT_IDS, type AgentDefinition } from "./AgentDefinition.js";
import { splitFrontmatter, parseScalars, parseInlineArray, parseBool } from "./frontmatter.js";

export const AGENTS_DIR = join(homedir(), ".config", "ai-cli", "agents");

/** Parse one user agent file. Returns null if invalid (no name). */
export function parseAgentFile(content: string): AgentDefinition | null {
  const { raw, body } = splitFrontmatter(content);
  if (raw === null) return null;
  const scalars = parseScalars(raw);
  if (!scalars.name) return null;

  const tools = scalars.tools ? parseInlineArray(scalars.tools) : null;
  const suffix = body.trim() ? `## Agent Instructions\n${body.trim()}` : undefined;

  return {
    id: scalars.name,
    name: scalars.name,
    description: scalars.description ?? "",
    tools: tools ?? "all",
    readonly: parseBool(scalars.readonly),
    model: scalars.model || undefined,
    systemPromptSuffix: suffix,
  };
}

/**
 * Load user-defined agents from a directory. Invalid files and names that
 * collide with built-ins are skipped with a warning.
 */
export async function loadUserAgents(dir: string = AGENTS_DIR): Promise<AgentDefinition[]> {
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  const agents: AgentDefinition[] = [];
  for (const file of files) {
    try {
      const agent = parseAgentFile(await readFile(join(dir, file), "utf-8"));
      if (!agent) { console.error(`Skipping invalid agent (missing name): ${file}`); continue; }
      if (BUILTIN_AGENT_IDS.has(agent.id)) {
        console.error(`Agent name "${agent.id}" is reserved — skipping ${file}`);
        continue;
      }
      agents.push(agent);
    } catch (err) {
      console.error(`Skipping unreadable agent ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return agents;
}
