import { Box, Text } from "ink";
import type { Theme } from "../theme.js";
import type { CommandMeta } from "../../chatCommands.js";

interface CommandPaletteProps {
  matches: CommandMeta[];
  theme: Theme;
}

/** Autocomplete popup shown above the input while a slash command is being typed. */
export function CommandPalette({ matches, theme }: CommandPaletteProps) {
  if (matches.length === 0) return null;
  return (
    <Box flexDirection="column">
      {matches.map((c, i) => (
        <Box key={c.name}>
          <Text color={i === 0 ? theme.accent : theme.toolName}>
            /{c.name}
            {c.arg ? ` ${c.arg}` : ""}
          </Text>
          <Text color={theme.muted}> — {c.help}</Text>
        </Box>
      ))}
      <Text color={theme.muted}>Tab to complete</Text>
    </Box>
  );
}
