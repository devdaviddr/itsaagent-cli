import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import type { Theme } from "../theme.js";
import { Spinner } from "../Spinner.js";

interface InputBoxProps {
  theme: Theme;
  prompt: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  running: boolean;
}

/** Fixed bottom input. Swapped for a working indicator while a turn runs. */
export function InputBox({ theme, prompt, value, onChange, onSubmit, running }: InputBoxProps) {
  if (running) {
    return (
      <Box>
        <Spinner color={theme.accent} />
        <Text color={theme.muted}> working…</Text>
      </Box>
    );
  }
  return (
    <Box>
      <Text color={theme.accent}>{prompt} </Text>
      <TextInput value={value} onChange={onChange} onSubmit={onSubmit} />
    </Box>
  );
}
