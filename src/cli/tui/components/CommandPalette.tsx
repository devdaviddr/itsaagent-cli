import { Box, Text } from "ink";
import type { Theme } from "../theme.js";
import type { CommandMeta } from "../../chatCommands.js";

interface CommandPaletteProps {
  matches: CommandMeta[];
  theme: Theme;
  width: number;
}

/** Autocomplete popup; the top (completed-on-Tab) match shows a full-width highlight bar. */
export function CommandPalette({ matches, theme, width }: CommandPaletteProps) {
  if (matches.length === 0) return null;
  const labelWidth = 16;
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
        if (i === 0) {
          // Selected row: a solid bar spanning the panel width.
          const line = `${label.padEnd(labelWidth)}${c.help}`;
          const padded = line.length >= width ? line.slice(0, width) : line.padEnd(width);
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
