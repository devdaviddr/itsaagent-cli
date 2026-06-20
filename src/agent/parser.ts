export interface ParsedResponse {
  thought?: string;
  toolCall?: { name: string; args: Record<string, unknown> };
  answer?: string;
  /** true only when the model used an explicit <answer> tag — false for unstructured fallback */
  isExplicitAnswer: boolean;
}

/** Accept either `args` (our format) or `arguments` (OpenAI/Ollama style) as the tool args object. */
function extractArgs(o: { args?: unknown; arguments?: unknown }): Record<string, unknown> | undefined {
  const a = o.args ?? o.arguments;
  if (a && typeof a === "object" && !Array.isArray(a)) return a as Record<string, unknown>;
  return undefined;
}

export function parseResponse(raw: string): ParsedResponse {
  const result: ParsedResponse = { isExplicitAnswer: false };

  const thoughtMatch = raw.match(/<thought>([\s\S]*?)<\/thought>/i);
  if (thoughtMatch) result.thought = thoughtMatch[1].trim();

  // IMPORTANT: tool calls are checked BEFORE <answer>. Small models often emit a
  // tool call AND an <answer> in the same response (e.g. a write_file call
  // immediately followed by "File created successfully") — but at that point the
  // tool hasn't run yet, so the answer is a fabrication. We must execute the tool
  // and ignore the premature answer; the model gives its real answer next turn,
  // after seeing the [TOOL RESULT].

  // Primary: <tool_call> XML block
  const toolCallMatch = raw.match(/<tool_call>([\s\S]*?)<\/tool_call>/i);
  if (toolCallMatch) {
    try {
      const parsed = JSON.parse(toolCallMatch[1].trim()) as { name?: unknown; args?: unknown; arguments?: unknown };
      if (typeof parsed.name === "string") {
        result.toolCall = { name: parsed.name, args: extractArgs(parsed) ?? {} };
        return result;
      }
    } catch { /* fall through */ }
  }

  // Fallback: legacy TOOL: name {args} line
  for (const line of raw.split("\n")) {
    const match = line.match(/^TOOL:\s*(\w+)\s*(.*)$/);
    if (!match) continue;
    const argsStr = match[2].trim();
    try {
      result.toolCall = { name: match[1], args: argsStr ? (JSON.parse(argsStr) as Record<string, unknown>) : {} };
    } catch {
      result.toolCall = { name: match[1], args: {} };
    }
    return result;
  }

  // Fallback: bare JSON {"name":"...","args":{...}} without wrapper tags
  // Search only in text after </thought> so JSON embedded inside thought reasoning
  // is never mistaken for a tool call, but bare JSON emitted after the thought IS picked up.
  {
    const thoughtEnd = raw.lastIndexOf("</thought>");
    const searchIn = thoughtEnd !== -1 ? raw.slice(thoughtEnd + "</thought>".length) : raw;
    const nameIdx = searchIn.indexOf('"name"');
    if (nameIdx !== -1) {
      const braceStart = searchIn.lastIndexOf("{", nameIdx);
      if (braceStart !== -1) {
        const substr = searchIn.slice(braceStart);
        let depth = 0;
        let end = -1;
        for (let i = 0; i < substr.length; i++) {
          if (substr[i] === "{") depth++;
          else if (substr[i] === "}") {
            depth--;
            if (depth === 0) { end = i; break; }
          }
        }
        if (end !== -1) {
          try {
            const parsed = JSON.parse(substr.slice(0, end + 1)) as { name?: unknown; args?: unknown; arguments?: unknown };
            const args = extractArgs(parsed);
            if (typeof parsed.name === "string" && args) {
              result.toolCall = { name: parsed.name, args };
              return result;
            }
          } catch { /* ignore */ }
        }
      }
    }
  }

  // No tool call found — now honour an explicit <answer> as the final answer.
  const answerMatch = raw.match(/<answer>([\s\S]*?)<\/answer>/i);
  if (answerMatch) {
    result.answer = answerMatch[1].trim();
    result.isExplicitAnswer = true;
    return result;
  }

  // No structure — treat whole response as final answer.
  result.answer = raw.trim();
  return result;
}

/** Sort-keyed stringify so loop detection is key-order independent */
export function stableKey(name: string, args: Record<string, unknown>): string {
  return `${name}:${JSON.stringify(args, Object.keys(args).sort())}`;
}

/**
 * Heuristic: does this "answer" actually read like a mid-task status update
 * ("Next I will edit the config…") rather than a finished result? Small models
 * routinely wrap a progress narration in <answer> and quit. Conservative on
 * purpose — only high-confidence continuation phrasing — so genuine final
 * answers are not re-prompted. Used to nudge the agent to keep going (once).
 */
const MID_TASK_PATTERNS: RegExp[] = [
  /\bnext,?\s+I(?:'ll| will| am going to| need to)\b/i,
  /\bnow\s+I(?:'ll| will| am going to| need to)\b/i,
  /\bI(?:'ll| will)\s+(?:now\s+|next\s+)?(?:start|begin|create|write|add|implement|proceed|continue|set up|install)\b/i,
  /\blet me\s+(?:now\s+)?(?:start|begin|create|write|add|implement|proceed|install|set up)\b/i,
  /\bI(?:'m| am)\s+going to\b/i,
  /\bproceeding to\b/i,
  /\bnext step\b/i,
  /\bthe next step is\b/i,
];

export function looksLikeMidTaskAnswer(text: string): boolean {
  const t = (text ?? "").trim();
  if (t.length === 0) return false;
  return MID_TASK_PATTERNS.some((re) => re.test(t));
}
