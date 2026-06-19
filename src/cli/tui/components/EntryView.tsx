import { Box, Text } from "ink";
import type { Entry } from "../state/conversation.js";
import type { Theme } from "../theme.js";

/** Compact one-line preview of tool args for the collapsed header. */
function argSummary(args: Record<string, unknown>, width: number): string {
  const json = JSON.stringify(args ?? {});
  const flat = json.replace(/\s+/g, " ");
  return flat.length > width ? flat.slice(0, Math.max(0, width - 1)) + "…" : flat;
}

interface EntryViewProps {
  entry: Entry;
  theme: Theme;
  width: number;
}

/**
 * Render a single conversation entry. Tool blocks get a richer, collapsible
 * treatment in F-03; this is the baseline themed rendering for the shell.
 */
export function EntryView({ entry, theme, width }: EntryViewProps) {
  switch (entry.kind) {
    case "user":
      return (
        <Box>
          <Text color={theme.user} bold>
            ›{" "}
          </Text>
          <Text color={theme.user}>{entry.text}</Text>
        </Box>
      );

    case "thought":
      return (
        <Box>
          <Text color={theme.thought}>● </Text>
          <Text color={theme.muted} wrap="wrap">
            {entry.text}
          </Text>
        </Box>
      );

    case "answer":
      return (
        <Box>
          <Text color={theme.assistant} wrap="wrap">
            {entry.text}
          </Text>
        </Box>
      );

    case "error":
      return (
        <Box>
          <Text color={theme.error} wrap="wrap">
            ✗ {entry.text}
          </Text>
        </Box>
      );

    case "notice":
      return (
        <Box>
          <Text color={theme.muted} wrap="wrap">
            {entry.text}
          </Text>
        </Box>
      );

    case "tool": {
      const icon =
        entry.status === "running" ? "…" : entry.status === "success" ? "✓" : "✗";
      const iconColor =
        entry.status === "running"
          ? theme.warning
          : entry.status === "success"
            ? theme.success
            : theme.error;
      return (
        <Box flexDirection="column">
          <Box>
            <Text color={theme.toolName}>▸ {entry.name} </Text>
            <Text color={theme.muted}>{argSummary(entry.args, Math.max(10, width - entry.name.length - 6))}</Text>
            <Text color={iconColor}> {icon}</Text>
          </Box>
          {entry.expanded && entry.result ? (
            <Box marginLeft={2}>
              <Text color={theme.muted} wrap="wrap">
                {entry.result.success ? entry.result.data : entry.result.error || entry.result.data}
              </Text>
            </Box>
          ) : null}
        </Box>
      );
    }
  }
}
