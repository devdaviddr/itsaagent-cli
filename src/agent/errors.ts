export class AgentError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "AgentError";
    this.code = code;
  }
}

export class ProviderError extends AgentError {
  readonly statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message, "PROVIDER_ERROR");
    this.name = "ProviderError";
    this.statusCode = statusCode;
  }
}

export class ToolError extends AgentError {
  readonly toolName: string;
  constructor(message: string, toolName: string) {
    super(message, "TOOL_ERROR");
    this.name = "ToolError";
    this.toolName = toolName;
  }
}

export class LoopDetectedError extends AgentError {
  readonly toolName: string;
  constructor(toolName: string) {
    super(`Loop detected: "${toolName}" called 3× with identical args. Aborting.`, "LOOP_DETECTED");
    this.name = "LoopDetectedError";
    this.toolName = toolName;
  }
}

export class MaxStepsError extends AgentError {
  constructor(steps: number) {
    super(`Max steps (${steps}) reached without a final answer.`, "MAX_STEPS");
    this.name = "MaxStepsError";
  }
}

export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
