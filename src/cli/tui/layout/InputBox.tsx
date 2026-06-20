import { Box, Text, TextInput } from "tuir";
import type { Theme } from "../theme.js";
import { SpinnerT } from "../components/SpinnerT.js";

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
    <Box flexDirection="column" paddingLeft={1}>
      <Box>
        {running ? (
          <>
            <SpinnerT color={theme.accent} />
            <Text color={theme.muted}> working…</Text>
          </>
        ) : (
          <>
            <Text color={theme.accent}>{"› "}</Text>
            <TextInput
              onChange={onChange}
              autoEnter
              exitKeymap={{ key: "return" }}
              onExit={(v: string) => onSubmit(v)}
              onUpArrow={onUpArrow}
              onDownArrow={onDownArrow}
              cursorColor={theme.accent}
              textStyle={{ color: theme.assistant }}
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
        <Text color={theme.accent}>{capitalize(agent)}</Text>
        <Text color={theme.muted}> · {model}</Text>
        {!providerOk ? <Text color={theme.warning}>   ⚠ provider unreachable</Text> : null}
      </Box>
    </Box>
  );
}
