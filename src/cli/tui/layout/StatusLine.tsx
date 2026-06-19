import { Box, Text } from "ink";
import type { Theme } from "../theme.js";
import { statusHint, type TuiMode } from "./chrome.js";

interface StatusLineProps {
  theme: Theme;
  mode: TuiMode;
  hiddenAbove: number;
  cwd: string;
  version: string;
  ctxRatio: number | null;
}

/**
 * Bottom chrome: a right-aligned key-hint line plus a full-width status bar
 * (cwd · agent context on the left, ctx % and version on the right).
 */
export function StatusLine({ theme, mode, hiddenAbove, cwd, version, ctxRatio }: StatusLineProps) {
  const hintColor = mode === "error" ? theme.error : mode === "running" ? theme.warning : theme.muted;
  const right =
    ctxRatio !== null ? `ctx ${ctxRatio}%  ·  v${version}` : `v${version}`;
  return (
    <Box flexDirection="column">
      <Box justifyContent="flex-end">
        {hiddenAbove > 0 ? <Text color={theme.muted}>↑ {hiddenAbove} more   </Text> : null}
        <Text color={hintColor}>{statusHint(mode)}</Text>
      </Box>
      <Box justifyContent="space-between">
        <Text color={theme.muted}>~ {cwd}</Text>
        <Text color={theme.muted}>{right}</Text>
      </Box>
    </Box>
  );
}
