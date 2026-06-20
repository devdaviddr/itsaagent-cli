import { Box, Text } from "tuir";
import type { Entry } from "../state/conversation.js";
import type { Theme } from "../theme.js";
import { EntryView } from "../components/EntryView.js";

interface MessageLogProps {
  /** Entries already windowed to the visible region by the caller. */
  visible: Entry[];
  theme: Theme;
  width: number;
  /** Hard height of the scroll area; content taller than this clips at the top. */
  rows: number;
  /** Live streaming text for the in-flight step (bounded to the active step). */
  live: string;
  focusedToolId: number | null;
}

/**
 * Scrollable transcript region. Bounded to `rows` and bottom-anchored with
 * overflow hidden, so a long answer keeps its latest lines visible above the
 * input and clips older content at the top instead of overflowing.
 */
export function MessageLog({ visible, theme, width, rows, live, focusedToolId }: MessageLogProps) {
  return (
    <Box flexDirection="column" height={rows} overflow="hidden" justifyContent="flex-end">
      {visible.map((entry) => (
        <Box key={entry.id} marginBottom={entry.kind === "answer" ? 1 : 0}>
          <EntryView entry={entry} theme={theme} width={width} focusedToolId={focusedToolId} />
        </Box>
      ))}
      {live ? (
        <Box>
          <Text color={theme.muted} wrap="truncate-end">
            {live.split("\n").slice(-1)[0]}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
