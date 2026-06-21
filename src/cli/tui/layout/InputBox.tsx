import { Box, Text, TextInput } from "tuir";
import type { Theme } from "../theme.js";

function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

interface InputBoxProps {
  theme: Theme;
  agent: string;
  model: string;
  /** Opaque binding from useTextInput in the parent. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChange: any;
  value: string;
  onSubmit: (v: string) => void;
  onUpArrow: () => void;
  onDownArrow: () => void;
  running: boolean;
  providerOk: boolean;
}

/**
 * opencode-style input panel: a left accent bar, the prompt/placeholder, and an
 * agent · model footer. The text value is owned by the parent's useTextInput.
 */
export function InputBox({ theme, agent, model, onChange, value, onSubmit, onUpArrow, onDownArrow, running, providerOk }: InputBoxProps) {
  return (
    <Box
      flexDirection="column"
      paddingLeft={1}
      borderStyle="single"
      borderColor={running ? theme.accent : theme.border}
      borderLeft
      borderTop={false}
      borderBottom={false}
      borderRight={false}
    >
      <Box>
        {running ? (
          <>
            <Text color={theme.accent} bold={theme.bold}>{"● "}</Text>
            <Text color={theme.muted}>responding — Esc to cancel</Text>
          </>
        ) : (
          <>
            {/* Prompt caret + the user's own colour, so typed input reads as
                distinctly "you" vs the assistant's generated output. */}
            <Text color={theme.user} bold={theme.bold}>{"› "}</Text>
            <TextInput
              onChange={onChange}
              autoEnter
              exitKeymap={{ key: "return" }}
              onExit={(v: string) => onSubmit(v)}
              onUpArrow={onUpArrow}
              onDownArrow={onDownArrow}
              cursorColor={theme.accent}
              textStyle={{ color: theme.user }}
            />
            {value.length === 0 ? (
              <Text color={theme.muted} dimColor>
                {'Ask anything…  "list the typescript files and count lines"'}
              </Text>
            ) : null}
          </>
        )}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.accent} bold={theme.bold}>{capitalize(agent)}</Text>
        <Text color={theme.muted}> · {model}</Text>
        {!providerOk ? <Text color={theme.warning}>   ⚠ provider unreachable</Text> : null}
      </Box>
    </Box>
  );
}
