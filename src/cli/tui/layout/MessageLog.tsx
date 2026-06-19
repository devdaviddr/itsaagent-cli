import { Box, Text } from "ink";
import type { Entry } from "../state/conversation.js";
import type { Theme } from "../theme.js";
import { EntryView } from "../components/EntryView.js";

interface MessageLogProps {
  /** Entries already windowed to the visible region by the caller. */
  visible: Entry[];
  theme: Theme;
  width: number;
  /** Live streaming text for the in-flight step (bounded to the active step). */
  live: string;
  focusedToolId: number | null;
}

/** Scrollable transcript region. Windowing is done by the parent so the status line can share it. */
export function MessageLog({ visible, theme, width, live, focusedToolId }: MessageLogProps) {
  return (
    <Box flexDirection="column" flexGrow={1}>
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
