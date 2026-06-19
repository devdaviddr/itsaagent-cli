import { Box, Text } from "ink";
import type { Theme } from "../theme.js";
import { statusHint, type TuiMode } from "./chrome.js";

interface StatusLineProps {
  theme: Theme;
  mode: TuiMode;
  hiddenAbove: number;
}

/** Bottom chrome: a contextual hint, plus a "more above" marker when scrolled. */
export function StatusLine({ theme, mode, hiddenAbove }: StatusLineProps) {
  const color = mode === "error" ? theme.error : mode === "running" ? theme.warning : theme.muted;
  return (
    <Box marginTop={1}>
      <Text color={color}>{statusHint(mode)}</Text>
      {hiddenAbove > 0 ? (
        <Text color={theme.muted}>  ↑ {hiddenAbove} more above</Text>
      ) : null}
    </Box>
  );
}
