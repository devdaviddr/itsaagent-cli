/** Minimal frontmatter helpers shared by the skill and agent loaders. */

export interface Frontmatter {
  /** Raw text between the --- fences, or null if there is no frontmatter. */
  raw: string | null;
  /** Document body after the closing fence (or the whole input if no fence). */
  body: string;
}

/** Split a markdown document into its YAML-ish frontmatter and body. */
export function splitFrontmatter(content: string): Frontmatter {
  const normalised = content.replace(/\r\n/g, "\n");
  if (!normalised.startsWith("---\n")) return { raw: null, body: content };
  const end = normalised.indexOf("\n---", 4);
  if (end === -1) return { raw: null, body: content };
  const raw = normalised.slice(4, end);
  // Body starts after the closing fence line.
  const afterFence = normalised.indexOf("\n", end + 1);
  const body = afterFence === -1 ? "" : normalised.slice(afterFence + 1);
  return { raw, body: body.replace(/^\n+/, "") };
}

/** Parse top-level `key: value` scalar lines (ignores indented/list lines). */
export function parseScalars(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    if (/^\s/.test(line) || line.trimStart().startsWith("-")) continue; // skip nested/list
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!m) continue;
    out[m[1]] = stripQuotes(m[2].trim());
  }
  return out;
}

export function stripQuotes(v: string): string {
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

/** Parse an inline array like `[a, b, c]` → ["a","b","c"]. Returns null if not an array. */
export function parseInlineArray(v: string): string[] | null {
  const t = v.trim();
  if (!t.startsWith("[") || !t.endsWith("]")) return null;
  const inner = t.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(",").map((s) => stripQuotes(s.trim())).filter(Boolean);
}

export function parseBool(v: string | undefined): boolean {
  return v?.trim().toLowerCase() === "true";
}
