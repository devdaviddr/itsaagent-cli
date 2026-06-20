import { Box, Text } from "tuir";
import type { Line } from "./flatten.js";
import type { Theme } from "../theme.js";

interface MessageLogProps {
  /** Lines already windowed to the visible region by the caller. */
  lines: Line[];
  theme: Theme;
  /** Inner height of the chat area. */
  rows: number;
  /** Outer width so the panel background fills the box. */
  width: number;
}

/**
 * The chat transcript: a distinct bordered, panel-coloured box. Content is
 * pre-windowed at the line level, so it scrolls line-by-line and never overflows.
 */
export function MessageLog({ lines, theme, rows, width }: MessageLogProps) {
  return (
    <Box
      flexDirection="column"
      height={rows + 2}
      width={width}
      borderStyle="round"
      borderColor={theme.accent}
      backgroundColor={theme.panel}
      paddingX={1}
      overflow="hidden"
    >
      {lines.map((l, i) => (
        <Text key={i} color={l.color} bold={l.bold} wrap="truncate-end">
          {l.text.length > 0 ? l.text : " "}
        </Text>
      ))}
    </Box>
  );
}
