import { EventEmitter } from "node:events";
import type { AgentConfig, Tool, ToolResult } from "../types.js";
import { createProvider } from "../providers/index.js";
import type { Provider } from "../providers/Provider.js";
import { getDefaultTools } from "../tools/index.js";
import { ContextManager } from "./ContextManager.js";
import { LoopDetectedError, MaxStepsError, toErrorMessage } from "./errors.js";
import type { AgentError } from "./errors.js";
import { SessionLogger } from "./SessionLogger.js";
import { parseResponse, stableKey } from "./parser.js";
import { buildSystemPrompt } from "./promptBuilder.js";

export interface AgentRuntimeEvents {
  start: [payload: { task: string; model: string; cwd: string; logPath: string }];
  step: [payload: { index: number; total: number }];
  chunk: [payload: { delta: string; stepIndex: number }];
  thought: [payload: { text: string; stepIndex: number }];
  "tool:call": [payload: { name: string; args: Record<string, unknown>; stepIndex: number }];
  "tool:result": [payload: { name: string; result: ToolResult; stepIndex: number }];
  answer: [payload: { text: string; steps: number; durationMs: number }];
  error: [payload: { error: AgentError; stepIndex?: number }];
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

  constructor(config: AgentConfig) {
    super();
    this.config = config;
    this.provider = createProvider(config.provider);
    this.ctx = new ContextManager(config.maxContextTokens);
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

  private async executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        data: "",
        error: `Unknown tool "${name}". Available: ${[...this.tools.keys()].join(", ")}`,
      };
    }
    try {
      return await tool.execute(args);
    } catch (err: unknown) {
      return { success: false, data: "", error: toErrorMessage(err) };
    }
  }

  async run(task: string): Promise<string> {
    const cwd = process.cwd();
    const startTime = Date.now();

    this.ctx.clear();
    this.ctx.add({ role: "system", content: buildSystemPrompt([...this.tools.values()], cwd) });
    this.ctx.add({ role: "user", content: task });

    await this.logger.init(task, this.config.provider.model, cwd);
    this.emit("start", { task, model: this.config.provider.model, cwd, logPath: this.logger.filePath });

    const callCounts = new Map<string, number>();

    for (let step = 1; step <= this.config.maxSteps; step++) {
      this.emit("step", { index: step, total: this.config.maxSteps });

      let raw = "";
      for await (const chunk of this.provider.stream(this.ctx.forProvider())) {
        raw += chunk.delta;
        if (chunk.delta) this.emit("chunk", { delta: chunk.delta, stepIndex: step });
      }

      const parsed = parseResponse(raw);

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
