export interface ParsedResponse {
  thought?: string;
  toolCall?: { name: string; args: Record<string, unknown> };
  answer?: string;
  /** true only when the model used an explicit <answer> tag — false for unstructured fallback */
  isExplicitAnswer: boolean;
}

export function parseResponse(raw: string): ParsedResponse {
  const result: ParsedResponse = { isExplicitAnswer: false };

  const thoughtMatch = raw.match(/<thought>([\s\S]*?)<\/thought>/i);
  if (thoughtMatch) result.thought = thoughtMatch[1].trim();

  // Explicit <answer> tag — definitive termination
  const answerMatch = raw.match(/<answer>([\s\S]*?)<\/answer>/i);
  if (answerMatch) {
    result.answer = answerMatch[1].trim();
    result.isExplicitAnswer = true;
    return result;
  }

  // Primary: <tool_call> XML block
  const toolCallMatch = raw.match(/<tool_call>([\s\S]*?)<\/tool_call>/i);
  if (toolCallMatch) {
    try {
      const parsed = JSON.parse(toolCallMatch[1].trim()) as { name?: unknown; args?: unknown };
      if (typeof parsed.name === "string") {
        result.toolCall = {
          name: parsed.name,
          args: (parsed.args && typeof parsed.args === "object" && !Array.isArray(parsed.args))
            ? (parsed.args as Record<string, unknown>)
            : {},
        };
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
            const parsed = JSON.parse(substr.slice(0, end + 1)) as { name?: unknown; args?: unknown };
            if (typeof parsed.name === "string" && parsed.args && typeof parsed.args === "object") {
              result.toolCall = { name: parsed.name, args: parsed.args as Record<string, unknown> };
              return result;
            }
          } catch { /* ignore */ }
        }
      }
    }
  }

  // No structure — treat whole response as final answer
  result.answer = raw.trim();
  return result;
}

/** Sort-keyed stringify so loop detection is key-order independent */
export function stableKey(name: string, args: Record<string, unknown>): string {
  return `${name}:${JSON.stringify(args, Object.keys(args).sort())}`;
}
