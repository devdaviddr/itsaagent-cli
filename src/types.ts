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
  /** Runtime-injected context notice (e.g. eviction warning). Pinned, never logged. */
  notice?: boolean;
}

export interface ProviderConfig {
  type: "ollama" | "openai-compat";
  baseUrl: string;
  model: string;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
  /** Context window (tokens) to request from the model server, e.g. Ollama num_ctx. */
  numCtx?: number;
  /** Optional extra stop sequences. */
  stop?: string[];
}

export interface SkillArg {
  name: string;
  description: string;
  required: boolean;
}

export interface Skill {
  name: string;
  description: string;
  args: SkillArg[];
  /** Markdown body; {{arg}} placeholders are interpolated before injection. */
  body: string;
}

export interface AgentConfig {
  provider: ProviderConfig;
  verbose: boolean;
  maxSteps: number;
  maxContextTokens: number;
  logDir?: string;
  /** Active agent definition. Defaults to the `build` agent when omitted. */
  agent?: import("./agent/AgentDefinition.js").AgentDefinition;
  /** Active skills whose (interpolated) bodies extend the system prompt. */
  skills?: Skill[];
  /** Include the few-shot exemplar in the system prompt (default true). */
  fewShot?: boolean;
  /** Restore a saved session (resume) instead of starting fresh. */
  restore?: import("./agent/Session.js").SerializedSession;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface StreamChunk {
  delta: string;
  done: boolean;
  /** Native function-calling output, present on the final chunk when the model calls a tool. */
  toolCalls?: ToolCall[];
}

/** OpenAI/Ollama function-calling tool schema. */
export interface ToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: ToolDefinition["parameters"];
  };
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
