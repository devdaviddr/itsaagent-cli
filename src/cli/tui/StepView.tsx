import { Box, Text } from "ink";
import type { StepRecord } from "../../types.js";
import { Spinner } from "./Spinner.js";

const STATUS_ICON: Record<string, string> = {
  thinking: "…",
  executing: "▶",
  done: "✓",
  error: "✗",
};

const STATUS_COLOR: Record<string, string> = {
  thinking: "cyan",
  executing: "yellow",
  done: "green",
  error: "red",
};

interface StepViewProps {
  step: StepRecord;
  isActive: boolean;
}

export function StepView({ step, isActive }: StepViewProps) {
  const color = STATUS_COLOR[step.status] ?? "white";
  const icon = STATUS_ICON[step.status] ?? "?";

  return (
    <Box flexDirection="column" marginBottom={0}>
      <Box>
        {isActive ? <Spinner color={color} /> : <Text color={color}>{icon}</Text>}
        <Text> </Text>
        <Text bold color={color}>
          Step {step.index}
        </Text>
        {step.toolName && (
          <Text color="cyan">
            {" "}
            · {step.toolName}
          </Text>
        )}
      </Box>

      {step.thought && (
        <Box marginLeft={2}>
          <Text color="yellow" dimColor>
            {step.thought.split("\n")[0]}
          </Text>
        </Box>
      )}

      {step.toolArgs && (
        <Box marginLeft={2}>
          <Text dimColor>{JSON.stringify(step.toolArgs).slice(0, 120)}</Text>
        </Box>
      )}

      {step.toolResult && (
        <Box marginLeft={2}>
          <Text color={step.toolResult.success ? "green" : "red"} dimColor>
            {step.toolResult.success
              ? (step.toolResult.data ?? "").slice(0, 120).replace(/\n/g, " ")
              : (step.toolResult.error ?? "error").slice(0, 120)}
          </Text>
        </Box>
      )}
    </Box>
  );
}
