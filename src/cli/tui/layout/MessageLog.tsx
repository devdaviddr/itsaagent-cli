import { Box, Text } from "tuir";
import type { Line } from "./flatten.js";
import type { Theme } from "../theme.js";
import { GeneratingLoader } from "../components/GeneratingLoader.js";

interface MessageLogProps {
  /** Lines already windowed to the visible region by the caller. */
  lines: Line[];
  theme: Theme;
  /** Inner (content) height of the chat area, excluding the top border row. */
  rows: number;
  /** Outer width so the panel background fills the box. */
  width: number;
  /** True when scrolled up (not following the tail) — highlights the top border. */
  scrolled?: boolean;
  /** True while the model is streaming a reply — shows the animated loader row. */
  generating?: boolean;
}

/**
 * The chat transcript: a distinct panel-coloured area with a TOP BORDER marking
 * the start of the chat region (visually separate from the input below). Content
 * is pre-windowed at the line level, so it scrolls line-by-line and never
 * overflows. The top border consumes one row, so the box is `rows + 1` tall; the
 * border turns accent-coloured while scrolled, as a "you're in history" cue.
 */
export function MessageLog({ lines, theme, rows, width, scrolled, generating }: MessageLogProps) {
  // The animated loader occupies the last row while generating, so keep one row
  // free for it (drop the oldest visible line — the tail is what matters live).
  const content = generating && lines.length >= rows ? lines.slice(lines.length - (rows - 1)) : lines;
  return (
    <Box
      flexDirection="column"
      height={rows + 1}
      width={width}
      backgroundColor={theme.panel}
      borderStyle="single"
      borderColor={scrolled ? theme.accent : theme.muted}
      borderTop
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      paddingX={1}
      overflow="hidden"
    >
      {content.map((l, i) => (
        <Text key={i} color={l.color} bold={l.bold} wrap="truncate-end">
          {l.text.length > 0 ? l.text : " "}
        </Text>
      ))}
      {generating ? <GeneratingLoader theme={theme} /> : null}
    </Box>
  );
}
