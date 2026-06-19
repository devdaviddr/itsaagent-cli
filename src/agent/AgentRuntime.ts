import { EventEmitter } from "node:events";
import type { AgentConfig, Tool, ToolResult, ToolSpec, ToolCall } from "../types.js";
import { createProvider } from "../providers/index.js";
import type { Provider } from "../providers/Provider.js";
import { getDefaultTools } from "../tools/index.js";
import { ContextManager } from "./ContextManager.js";
import { LoopDetectedError, MaxStepsError, toErrorMessage } from "./errors.js";
import type { AgentError } from "./errors.js";
import { SessionLogger } from "./SessionLogger.js";
import { parseResponse, stableKey, type ParsedResponse } from "./parser.js";
import { buildSystemPrompt } from "./promptBuilder.js";
import { agentPermitsTool, type AgentDefinition } from "./AgentDefinition.js";

export interface AgentRuntimeEvents {
  start: [payload: { task: string; model: string; cwd: string; logPath: string }];
  step: [payload: { index: number; total: number }];
  chunk: [payload: { delta: string; stepIndex: number }];
  thought: [payload: { text: string; stepIndex: number }];
  "tool:call": [payload: { name: string; args: Record<string, unknown>; stepIndex: number }];
  "tool:result": [payload: { name: string; result: ToolResult; stepIndex: number }];
  answer: [payload: { text: string; steps: number; durationMs: number }];
  error: [payload: { error: AgentError; stepIndex?: number }];
  "context:evict": [payload: { evicted: number; ratio: number }];
  "context:usage": [payload: { used: number; max: number; ratio: number }];
}

function formatToolResult(tool: string, args: Record<string, unknown>, result: ToolResult): string {
  let out = `[TOOL RESULT: ${tool} ${JSON.stringify(args)}]\n`;
  if (result.exitCode !== undefined) out += `Exit: ${result.exitCode}\n`;
  if (result.data) {
    out += result.data.length > 6000 ? result.data.slice(0, 6000) + "\n…[truncated]" : result.data;
  }
  if (result.error) out += (result.data ? "\n---\n" : "") + `Error: ${result.error.slice(0, 1500)}`;
  return out;
}

export class AgentRuntime extends EventEmitter<AgentRuntimeEvents> {
  private readonly config: AgentConfig;
  private readonly provider: Provider;
  private readonly ctx: ContextManager;
  private readonly tools: Map<string, Tool>;
  private readonly logger: SessionLogger;
  private readonly agent?: AgentDefinition;
  /** Cached native-tool-use capability of the active model (detected once). */
  private toolUseMode: boolean | undefined;

  constructor(config: AgentConfig) {
    super();
    this.config = config;
    this.agent = config.agent;
    this.provider = createProvider(config.provider);
    this.ctx = new ContextManager(
      config.maxContextTokens,
      (evicted) => {
        this.emit("context:evict", { evicted, ratio: this.ctx.usage().ratio });
      },
      (usage) => {
        this.emit("context:usage", { used: usage.total, max: usage.max, ratio: usage.ratio });
      },
    );
    this.logger = new SessionLogger(config.logDir);
    this.tools = new Map();
    for (const t of getDefaultTools()) {
      this.tools.set(t.definition.name, t);
    }
    // Prevent unhandled 'error' event crashes when no listener is attached
    this.on("error", () => {});
  }

  /** Expose verbose flag so output layer can read it without a private cast */
  get verbose(): boolean { return this.config.verbose; }

  /** True if the active agent permits calling the named tool. */
  private isToolPermitted(name: string): boolean {
    if (!this.agent) return true; // no agent = unrestricted (back-compat)
    return agentPermitsTool(this.agent, name);
  }

  /** Registered tools the active agent is allowed to see and call. */
  private permittedTools(): Tool[] {
    return [...this.tools.values()].filter((t) => this.isToolPermitted(t.definition.name));
  }

  /** Permitted tools translated to the provider's function-calling schema. */
  private toolSpecs(): ToolSpec[] {
    return this.permittedTools().map((t) => ({
      type: "function",
      function: {
        name: t.definition.name,
        description: t.definition.description,
        parameters: t.definition.parameters,
      },
    }));
  }

  /** Detect (once) whether the active model supports native tool calling. */
  async detectToolUse(): Promise<boolean> {
    if (this.toolUseMode === undefined) {
      this.toolUseMode = this.provider.supportsTools ? await this.provider.supportsTools() : false;
    }
    return this.toolUseMode;
  }

  private async executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.isToolPermitted(name)) {
      return {
        success: false,
        data: "",
        error: "Tool not permitted by active agent",
      };
    }
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        data: "",
        error: `Unknown tool "${name}". Available: ${this.permittedTools().map((t) => t.definition.name).join(", ")}`,
      };
    }
    try {
      return await tool.execute(args);
    } catch (err: unknown) {
      return { success: false, data: "", error: toErrorMessage(err) };
    }
  }

  /** Initialise a persistent chat session. Call once before continueChat(). */
  initSession(): void {
    const cwd = process.cwd();
    this.ctx.clear();
    this.ctx.add({ role: "system", content: buildSystemPrompt(this.permittedTools(), cwd, this.agent?.systemPromptSuffix, this.config.skills) });
  }

  /**
   * Continue an existing chat session with a new user message.
   * Context from previous turns is preserved. Call initSession() first.
   */
  async continueChat(task: string): Promise<string> {
    const startTime = Date.now();
    this.ctx.add({ role: "user", content: task });
    await this.detectToolUse();
    await this.logger.init(task, this.config.provider.model, process.cwd());
    this.emit("start", { task, model: this.config.provider.model, cwd: process.cwd(), logPath: this.logger.filePath });
    return this.runLoop(startTime);
  }

  async run(task: string): Promise<string> {
    const cwd = process.cwd();
    const startTime = Date.now();

    this.ctx.clear();
    this.ctx.add({ role: "system", content: buildSystemPrompt(this.permittedTools(), cwd, this.agent?.systemPromptSuffix, this.config.skills) });
    this.ctx.add({ role: "user", content: task });

    await this.detectToolUse();
    await this.logger.init(task, this.config.provider.model, cwd);
    this.emit("start", { task, model: this.config.provider.model, cwd, logPath: this.logger.filePath });
    return this.runLoop(startTime);
  }

  private async runLoop(startTime: number): Promise<string> {
    const callCounts = new Map<string, number>();
    const recencyWindow: string[] = []; // last N tool names
    const failureCounts = new Map<string, number>(); // consecutive failures per tool
    let lastNudgeStep = -10;
    const useTools = this.toolUseMode === true;
    const toolSpecs = useTools ? this.toolSpecs() : undefined;

    for (let step = 1; step <= this.config.maxSteps; step++) {
      this.emit("step", { index: step, total: this.config.maxSteps });

      let raw = "";
      let nativeCalls: ToolCall[] | undefined;
      for await (const chunk of this.provider.stream(this.ctx.forProvider(), toolSpecs)) {
        raw += chunk.delta;
        if (chunk.delta) this.emit("chunk", { delta: chunk.delta, stepIndex: step });
        if (chunk.toolCalls && chunk.toolCalls.length > 0) nativeCalls = chunk.toolCalls;
      }

      // Native tool-use: structure comes from the API, so parseResponse is skipped.
      // When there are no structured tool_calls (even a tool-capable model may emit
      // a text tool call because the prompt describes that format), fall back to the
      // text parser so those calls are still honoured.
      let parsed: ParsedResponse;
      if (useTools && nativeCalls && nativeCalls.length > 0) {
        parsed = { thought: raw.trim() || undefined, toolCall: nativeCalls[0], isExplicitAnswer: false };
      } else {
        parsed = parseResponse(raw);
      }

      if (parsed.thought) {
        this.emit("thought", { text: parsed.thought, stepIndex: step });
      }

      this.ctx.add({ role: "assistant", content: raw });

      if (parsed.answer !== undefined && parsed.isExplicitAnswer) {
        const durationMs = Date.now() - startTime;
        await this.logger.logAnswer(parsed.answer);
        this.emit("answer", { text: parsed.answer, steps: step, durationMs });
        return parsed.answer;
      }

      if (!parsed.toolCall) {
        if (parsed.thought && !parsed.isExplicitAnswer) {
          // Model produced only a thought with no action — reprompt rather than terminate
          this.ctx.add({ role: "user", content: "Continue. Use a tool or provide your <answer>." });
          continue;
        }
        // Fully unstructured response — treat as final answer
        const answer = raw.trim();
        const durationMs = Date.now() - startTime;
        await this.logger.logAnswer(answer);
        this.emit("answer", { text: answer, steps: step, durationMs });
        return answer;
      }

      const { name, args } = parsed.toolCall;

      // Loop detection — key is order-independent via stableKey
      const callKey = stableKey(name, args);
      const count = (callCounts.get(callKey) ?? 0) + 1;
      callCounts.set(callKey, count);
      if (count >= 3) {
        const err = new LoopDetectedError(name);
        this.emit("error", { error: err, stepIndex: step });
        await this.logger.logError(err.message);
        return err.message;
      }

      this.emit("tool:call", { name, args, stepIndex: step });
      const result = await this.executeTool(name, args);
      this.emit("tool:result", { name, result, stepIndex: step });

      await this.logger.logStep(step, parsed.thought, name, args, result);
      this.ctx.add({ role: "user", content: formatToolResult(name, args, result) });

      // --- Failure escalation: consecutive failures of the same tool ---
      if (!result.success) {
        const fails = (failureCounts.get(name) ?? 0) + 1;
        failureCounts.set(name, fails);
        if (fails >= 3) {
          const err = new LoopDetectedError(name);
          const msg = `Tool ${name} failed 3 times consecutively`;
          this.emit("error", { error: err, stepIndex: step });
          await this.logger.logError(msg);
          return msg;
        }
        if (fails === 2) {
          this.ctx.add({
            role: "user",
            content: `[AGENT NOTICE: ${name} has failed twice in a row. Before trying again, state explicitly why the previous attempts failed and what you will do differently.]`,
          });
        }
      } else {
        failureCounts.set(name, 0); // reset streak on success
      }

      // --- Recency-window loop detection (semantic loop nudge) ---
      recencyWindow.push(name);
      if (recencyWindow.length > 8) recencyWindow.shift();
      const sameToolCount = recencyWindow.filter((n) => n === name).length;
      if (sameToolCount >= 5 && step - lastNudgeStep >= 4) {
        lastNudgeStep = step;
        this.ctx.add({
          role: "user",
          content: `[AGENT NOTICE: You have called ${name} ${sameToolCount} times recently. Do you have enough information to proceed, or are you stuck? State what you are looking for before calling another tool.]`,
        });
      }
    }

    const err = new MaxStepsError(this.config.maxSteps);
    this.emit("error", { error: err });
    await this.logger.logError(err.message);
    return err.message;
  }

  async checkProvider(): Promise<{ ok: boolean; models: Array<{ name: string; size?: number }> }> {
    const ok = await this.provider.checkHealth();
    if (!ok) return { ok: false, models: [] };
    const models = await this.provider.listModels();
    return { ok: true, models };
  }

  get logPath(): string { return this.logger.filePath; }
}
