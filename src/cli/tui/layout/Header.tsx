import { Box, Text } from "ink";
import type { Theme } from "../theme.js";
import { ctxColor } from "../theme.js";
import { buildBar } from "../../contextBar.js";
import { headerText } from "./chrome.js";

interface HeaderProps {
  theme: Theme;
  agent: string;
  model: string;
  usage: { used: number; max: number; ratio: number } | null;
  providerOk: boolean;
}

/** Top chrome: title · agent · model, a context bar, and a provider warning. */
export function Header({ theme, agent, model, usage, providerOk }: HeaderProps) {
  return (
    <Box justifyContent="space-between" marginBottom={1}>
      <Text bold color={theme.accent}>
        {headerText(agent, model)}
      </Text>
      {!providerOk ? (
        <Text color={theme.warning}>⚠ provider unreachable</Text>
      ) : usage && usage.max > 0 ? (
        <Text color={ctxColor(usage.ratio, theme)}>
          [{buildBar(usage.ratio, 10)}] {usage.ratio}%
        </Text>
      ) : null}
    </Box>
  );
}
