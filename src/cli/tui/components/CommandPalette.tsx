import { Box, Text } from "tuir";
import type { Theme } from "../theme.js";
import type { CommandMeta } from "../../chatCommands.js";

interface CommandPaletteProps {
  matches: CommandMeta[];
  theme: Theme;
  width: number;
  /** Index of the highlighted row (navigable with ↑/↓). */
  index: number;
}

/** Autocomplete popup; the highlighted (↑/↓ selectable) match shows a full-width bar. */
export function CommandPalette({ matches, theme, width, index }: CommandPaletteProps) {
  if (matches.length === 0) return null;
  const labelWidth = 16;
  // The panel has a left border (1 col) + paddingLeft (1 col); keep the
  // highlight bar inside that so it doesn't wrap a fragment onto the next line.
  const barWidth = Math.max(10, width - 2);
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.accent}
      borderTop={false}
      borderRight={false}
      borderBottom={false}
      paddingLeft={1}
    >
      {matches.map((c, i) => {
        const label = `/${c.name}${c.arg ? ` ${c.arg}` : ""}`;
        if (i === index) {
          // Selected row: a solid bar spanning the panel's inner width.
          const line = `${label.padEnd(labelWidth)}${c.help}`;
          const padded = line.length >= barWidth ? line.slice(0, barWidth) : line.padEnd(barWidth);
          return (
            <Text key={c.name} backgroundColor={theme.accent} color="black">
              {padded}
            </Text>
          );
        }
        return (
          <Box key={c.name}>
            <Text color={theme.toolName}>{label.padEnd(labelWidth)}</Text>
            <Text color={theme.muted}>{c.help}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
