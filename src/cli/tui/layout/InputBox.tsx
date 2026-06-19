import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import type { Theme } from "../theme.js";
import { Spinner } from "../Spinner.js";

function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

interface InputBoxProps {
  theme: Theme;
  agent: string;
  model: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  running: boolean;
  providerOk: boolean;
}

/**
 * opencode-style input panel: a left accent bar, the prompt/placeholder, and an
 * agent · model footer inside the panel. Swaps to a working indicator mid-run.
 */
export function InputBox({ theme, agent, model, value, onChange, onSubmit, running, providerOk }: InputBoxProps) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.accent}
      borderTop={false}
      borderRight={false}
      borderBottom={false}
      paddingLeft={1}
    >
      <Box>
        {running ? (
          <>
            <Spinner color={theme.accent} />
            <Text color={theme.muted}> working…</Text>
          </>
        ) : (
          <>
            <Text color={theme.accent}>{"› "}</Text>
            <TextInput
              value={value}
              onChange={onChange}
              onSubmit={onSubmit}
              placeholder={'Ask anything…  "list the typescript files and count lines"'}
            />
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
