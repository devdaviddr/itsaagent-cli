import { Box, Text } from "tuir";
import type { ToolEntry } from "../state/conversation.js";
import type { Theme } from "../theme.js";
import { resultLines, clampLines, moreMarker, collapsedSummary } from "./toolFormat.js";

/** Lines of result shown when a block is expanded before the "more" marker kicks in. */
const MAX_EXPANDED_LINES = 20;

function statusIcon(status: ToolEntry["status"]): string {
  return status === "running" ? "…" : status === "success" ? "✓" : "✗";
}

interface ToolBlockProps {
  entry: ToolEntry;
  theme: Theme;
  width: number;
  focused: boolean;
}

/** A collapsible, themed tool call: collapsed shows a summary, expanded shows args + result. */
export function ToolBlock({ entry, theme, width, focused }: ToolBlockProps) {
  const icon = statusIcon(entry.status);
  const iconColor =
    entry.status === "running" ? theme.warning : entry.status === "success" ? theme.success : theme.error;
  const nameColor = focused ? theme.accent : theme.toolName;
  const marker = focused ? "▶" : "▸";
  const argStr = JSON.stringify(entry.args ?? {}).replace(/\s+/g, " ");
  const argCap = Math.max(10, width - entry.name.length - 8);
  const argShort = argStr.length > argCap ? argStr.slice(0, argCap - 1) + "…" : argStr;
  const lines = resultLines(entry.result);

  if (!entry.expanded) {
    const summary = collapsedSummary(entry.result);
    const hidden = Math.max(0, lines.length - (summary ? 1 : 0));
    return (
      <Box flexDirection="column">
        <Box>
          <Text color={nameColor}>
            {marker} {entry.name}{" "}
          </Text>
          <Text color={theme.muted}>{argShort}</Text>
          <Text color={iconColor}> {icon}</Text>
        </Box>
        {summary ? (
          <Box marginLeft={2}>
            <Text color={theme.muted} wrap="truncate-end">
              {summary}
              {hidden > 0 ? `   ${moreMarker(hidden)}` : ""}
            </Text>
          </Box>
        ) : null}
      </Box>
    );
  }

  const { shown, hidden } = clampLines(lines, MAX_EXPANDED_LINES);
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={nameColor}>
          {marker} {entry.name}
        </Text>
        <Text color={iconColor}> {icon}</Text>
      </Box>
      <Box marginLeft={2}>
        <Text color={theme.muted} wrap="wrap">
          args: {argStr}
        </Text>
      </Box>
      <Box marginLeft={2} flexDirection="column">
        {shown.map((l, i) => (
          <Text key={i} color={theme.muted} wrap="wrap">
            {l.length > 0 ? l : " "}
          </Text>
        ))}
        {hidden > 0 ? <Text color={theme.muted}>{moreMarker(hidden)}</Text> : null}
      </Box>
    </Box>
  );
}
