import { useEffect, useState } from "react";
import type { AgentRuntime } from "../../../agent/AgentRuntime.js";
import type { StepRecord, StepStatus } from "../../../types.js";

export interface AgentState {
  status: "idle" | "running" | "done" | "error";
  currentStep: number;
  totalSteps: number;
  steps: StepRecord[];
  currentChunk: string;
  answer: string;
  errorMessage: string;
  logPath: string;
  model: string;
  cwd: string;
}

function initialState(): AgentState {
  return {
    status: "idle",
    currentStep: 0,
    totalSteps: 0,
    steps: [],
    currentChunk: "",
    answer: "",
    errorMessage: "",
    logPath: "",
    model: "",
    cwd: "",
  };
}

function updateStep(
  steps: StepRecord[],
  index: number,
  update: Partial<StepRecord>,
): StepRecord[] {
  const existing = steps.find((s) => s.index === index);
  if (existing) {
    return steps.map((s) => (s.index === index ? { ...s, ...update } : s));
  }
  return [...steps, { index, status: "thinking" as StepStatus, ...update }];
}

export function useAgentEvents(runtime: AgentRuntime): AgentState {
  const [state, setState] = useState<AgentState>(initialState);

  useEffect(() => {
    runtime.on("start", ({ model, cwd, logPath }) => {
      setState((s) => ({ ...s, status: "running", model, cwd, logPath }));
    });

    runtime.on("step", ({ index, total }) => {
      setState((s) => ({
        ...s,
        currentStep: index,
        totalSteps: total,
        currentChunk: "",
        steps: updateStep(s.steps, index, { index, status: "thinking" }),
      }));
    });

    runtime.on("chunk", ({ delta }) => {
      setState((s) => ({ ...s, currentChunk: s.currentChunk + delta }));
    });

    runtime.on("thought", ({ text, stepIndex }) => {
      setState((s) => ({
        ...s,
        currentChunk: "",
        steps: updateStep(s.steps, stepIndex, { thought: text }),
      }));
    });

    runtime.on("tool:call", ({ name, args, stepIndex }) => {
      setState((s) => ({
        ...s,
        steps: updateStep(s.steps, stepIndex, { status: "executing", toolName: name, toolArgs: args }),
      }));
    });

    runtime.on("tool:result", ({ result, stepIndex }) => {
      setState((s) => ({
        ...s,
        steps: updateStep(s.steps, stepIndex, {
          status: result.success ? "done" : "error",
          toolResult: result,
        }),
      }));
    });

    runtime.on("answer", ({ text }) => {
      setState((s) => ({ ...s, status: "done", answer: text, currentChunk: "" }));
    });

    runtime.on("error", ({ error, stepIndex }) => {
      setState((s) => ({
        ...s,
        status: "error",
        errorMessage: error.message,
        currentChunk: "",
        ...(stepIndex !== undefined
          ? { steps: updateStep(s.steps, stepIndex, { status: "error" }) }
          : {}),
      }));
    });

    return () => { runtime.removeAllListeners(); };
  }, [runtime]);

  return state;
}
