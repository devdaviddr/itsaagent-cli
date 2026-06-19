import { useApp } from "ink";
import { Box, Static, Text } from "ink";
import { useEffect, useState } from "react";
import type { AgentRuntime } from "../../agent/AgentRuntime.js";
import type { StepRecord, StepStatus, ToolResult } from "../../types.js";
import { StepView } from "./StepView.js";
import { Spinner } from "./Spinner.js";
import { buildBar, formatUsage } from "../contextBar.js";

interface AgentViewState {
  status: "running" | "done" | "error";
  model: string;
  cwd: string;
  logPath: string;
  currentStep: number;
  totalSteps: number;
  steps: StepRecord[];
  currentChunk: string;
  answer: string;
  errorMessage: string;
  ctxUsed: number;
  ctxMax: number;
  ctxRatio: number;
}

function updateStep(
  steps: StepRecord[],
  index: number,
  patch: Partial<StepRecord>,
): StepRecord[] {
  const exists = steps.some((s) => s.index === index);
  if (exists) return steps.map((s) => (s.index === index ? { ...s, ...patch } : s));
  return [...steps, { index, status: "thinking" as StepStatus, ...patch }];
}

interface AgentViewProps {
  runtime: AgentRuntime;
  task: string;
  continueChat?: boolean;
  onDone: (answer: string) => void;
  onError: (message: string) => void;
}

export function AgentView({ runtime, task, continueChat = false, onDone, onError }: AgentViewProps) {
  const { exit } = useApp();
  const [state, setState] = useState<AgentViewState>({
    status: "running",
    model: "",
    cwd: "",
    logPath: "",
    currentStep: 0,
    totalSteps: 0,
    steps: [],
    currentChunk: "",
    answer: "",
    errorMessage: "",
    ctxUsed: 0,
    ctxMax: 0,
    ctxRatio: 0,
  });

  useEffect(() => {
    // All listeners registered synchronously before runtime.run() is called
    // This eliminates the race between event emission and listener attachment

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlers: Array<{ event: string; fn: (arg: any) => void }> = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function on(event: string, fn: (arg: any) => void) {
      runtime.on(event as never, fn as never);
      handlers.push({ event, fn });
    }

    on("start", ({ model, cwd, logPath }: { model: string; cwd: string; logPath: string }) => {
      setState((s) => ({ ...s, model, cwd, logPath }));
    });

    on("step", ({ index, total }: { index: number; total: number }) => {
      setState((s) => ({
        ...s,
        currentStep: index,
        totalSteps: total,
        currentChunk: "",
        steps: updateStep(s.steps, index, { index, status: "thinking" }),
      }));
    });

    on("chunk", ({ delta }: { delta: string }) => {
      setState((s) => ({ ...s, currentChunk: s.currentChunk + delta }));
    });

    on("thought", ({ text, stepIndex }: { text: string; stepIndex: number }) => {
      setState((s) => ({
        ...s,
        currentChunk: "",
        steps: updateStep(s.steps, stepIndex, { thought: text }),
      }));
    });

    on("tool:call", ({ name, args, stepIndex }: { name: string; args: Record<string, unknown>; stepIndex: number }) => {
      setState((s) => ({
        ...s,
        steps: updateStep(s.steps, stepIndex, { status: "executing", toolName: name, toolArgs: args }),
      }));
    });

    on("tool:result", ({ result, stepIndex }: { result: ToolResult; stepIndex: number }) => {
      setState((s) => ({
        ...s,
        steps: updateStep(s.steps, stepIndex, {
          status: result.success ? "done" : "error",
          toolResult: result,
        }),
      }));
    });

    on("context:usage", ({ used, max, ratio }: { used: number; max: number; ratio: number }) => {
      setState((s) => ({ ...s, ctxUsed: used, ctxMax: max, ctxRatio: ratio }));
    });

    on("answer", ({ text }: { text: string }) => {
      setState((s) => ({ ...s, status: "done", answer: text, currentChunk: "" }));
      onDone(text);
      exit();
    });

    on("error", ({ error }: { error: { message: string } }) => {
      setState((s) => ({ ...s, status: "error", errorMessage: error.message, currentChunk: "" }));
      onError(error.message);
      exit();
    });

    // Start the run AFTER all listeners are attached
    const invoke = continueChat ? runtime.continueChat(task) : runtime.run(task);
    invoke.catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      onError(msg);
      exit();
    });

    return () => {
      for (const { event, fn } of handlers) {
        runtime.off(event as never, fn as never);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const completedSteps = state.steps.filter((s) => s.status === "done" || s.status === "error");
  const activeStep = state.steps.find((s) => s.status === "thinking" || s.status === "executing");

  const ctxColor =
    state.ctxRatio > 80 ? "red" : state.ctxRatio >= 60 ? "yellow" : undefined;

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold>ItsAAgent</Text>
        {state.model ? <Text dimColor>  {state.model}  ·  {state.cwd}</Text> : null}
      </Box>

      {state.ctxMax > 0 ? (
        <Box marginBottom={1}>
          <Text color={ctxColor} dimColor={ctxColor === undefined}>
            ctx  [{buildBar(state.ctxRatio)}]  {formatUsage(state.ctxUsed, state.ctxMax, state.ctxRatio)}
          </Text>
        </Box>
      ) : null}

      <Box marginBottom={1}>
        <Text dimColor>Task: </Text>
        <Text>{task}</Text>
      </Box>

      {state.logPath ? (
        <Box marginBottom={1}>
          <Text dimColor>Log: {state.logPath}</Text>
        </Box>
      ) : null}

      <Static items={completedSteps}>
        {(step) => (
          <Box key={step.index}>
            <StepView step={step} isActive={false} />
          </Box>
        )}
      </Static>

      {activeStep ? (
        <Box flexDirection="column">
          <StepView step={activeStep} isActive />
          {state.currentChunk ? (
            <Box marginLeft={2}>
              <Text dimColor wrap="wrap">{state.currentChunk.slice(-300)}</Text>
            </Box>
          ) : null}
        </Box>
      ) : null}

      {state.status === "running" && !activeStep ? (
        <Box>
          <Spinner />
          <Text dimColor> initialising…</Text>
        </Box>
      ) : null}

      {state.status === "error" ? (
        <Box marginTop={1}>
          <Text color="red">{state.errorMessage}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
