export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

export interface ToolResult {
  success: boolean;
  data: string;
  error?: string;
  exitCode?: number;
}

export interface Tool {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}

export type MessageRole = "system" | "user" | "assistant";

export interface Message {
  role: MessageRole;
  content: string;
  timestamp: number;
}

export interface ProviderConfig {
  type: "ollama" | "openai-compat";
  baseUrl: string;
  model: string;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
}

export interface AgentConfig {
  provider: ProviderConfig;
  verbose: boolean;
  maxSteps: number;
  maxContextTokens: number;
  logDir?: string;
}

export interface StreamChunk {
  delta: string;
  done: boolean;
}

export type StepStatus = "thinking" | "executing" | "done" | "error";

export interface StepRecord {
  index: number;
  status: StepStatus;
  thought?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: ToolResult;
}
