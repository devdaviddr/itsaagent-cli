import { Box, Text } from "ink";
import type { Theme } from "../theme.js";

// figlet "Standard" rendering of "iaa" — the empty-state logo.
const LOGO = [
  " _              ",
  "(_) __ _  __ _  ",
  "| |/ _` |/ _` | ",
  "| | (_| | (_| | ",
  "|_|\\__,_|\\__,_| ",
];

interface BannerProps {
  theme: Theme;
}

/** Centered logo + tagline shown when the conversation is empty (opencode-style home). */
export function Banner({ theme }: BannerProps) {
  return (
    <Box flexDirection="column" alignItems="center">
      {LOGO.map((line, i) => (
        <Text key={i} color={theme.accent} bold>
          {line}
        </Text>
      ))}
      <Box marginTop={1}>
        <Text color={theme.muted}>ItsAAgent — local ReAct agent on Ollama</Text>
      </Box>
      <Box marginTop={1}>
        <Text color={theme.muted}>Type a task, or </Text>
        <Text color={theme.accent}>/</Text>
        <Text color={theme.muted}> for commands</Text>
      </Box>
    </Box>
  );
}
