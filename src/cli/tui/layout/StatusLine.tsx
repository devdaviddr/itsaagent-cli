import { Box, Text } from "tuir";
import type { Theme } from "../theme.js";
import { statusHint, type TuiMode } from "./chrome.js";

interface StatusLineProps {
  theme: Theme;
  mode: TuiMode;
  hiddenAbove: number;
  cwd: string;
  version: string;
  ctxRatio: number | null;
  /** Optional left-side note on the hint line (e.g. the plan→build handoff hint). */
  note?: string;
  /** Git status summary (e.g. "⎇ main · 3 changed"), shown by the cwd. */
  git?: string;
}

/**
 * Bottom chrome: a right-aligned key-hint line plus a full-width status bar
 * (cwd · agent context on the left, ctx % and version on the right).
 */
export function StatusLine({ theme, mode, hiddenAbove, cwd, version, ctxRatio, note, git }: StatusLineProps) {
  const hintColor = mode === "error" ? theme.error : mode === "running" ? theme.warning : theme.muted;
  const right =
    ctxRatio !== null ? `ctx ${ctxRatio}%  ·  v${version}` : `v${version}`;
  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        {note ? <Text color={theme.accent}>{note}</Text> : <Text> </Text>}
        <Box>
          {hiddenAbove > 0 ? <Text color={theme.muted}>↑ {hiddenAbove} more   </Text> : null}
          <Text color={hintColor}>{statusHint(mode)}</Text>
        </Box>
      </Box>
      <Box justifyContent="space-between">
        <Text color={theme.muted}>~ {cwd}{git ? `   ${git}` : ""}</Text>
        <Text color={theme.muted}>{right}</Text>
      </Box>
    </Box>
  );
}
