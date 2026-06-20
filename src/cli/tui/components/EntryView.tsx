import { Box, Text } from "tuir";
import type { Entry } from "../state/conversation.js";
import type { Theme } from "../theme.js";
import { ToolBlock } from "./ToolBlock.js";

interface EntryViewProps {
  entry: Entry;
  theme: Theme;
  width: number;
  focusedToolId?: number | null;
}

/** Render a single conversation entry; tool entries delegate to the collapsible ToolBlock. */
export function EntryView({ entry, theme, width, focusedToolId }: EntryViewProps) {
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

    case "tool":
      return (
        <ToolBlock
          entry={entry}
          theme={theme}
          width={width}
          focused={entry.id === focusedToolId}
        />
      );
  }
}
