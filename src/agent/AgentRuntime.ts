import { EventEmitter } from "node:events";
import type { AgentConfig, Tool, ToolResult, ToolSpec, ToolCall } from "../types.js";
import { createProvider } from "../providers/index.js";
import type { Provider } from "../providers/Provider.js";
import { getDefaultTools } from "../tools/index.js";
import { ContextManager } from "./ContextManager.js";
import { Session } from "./Session.js";
import { LoopDetectedError, MaxStepsError, toErrorMessage } from "./errors.js";
import type { AgentError } from "./errors.js";
import { SessionLogger } from "./SessionLogger.js";
import { parseResponse, stableKey, looksLikeMidTaskAnswer, type ParsedResponse } from "./parser.js";
import { buildSystemPrompt } from "./promptBuilder.js";
import { agentPermitsTool, MUTATION_TOOLS, type AgentDefinition } from "./AgentDefinition.js";

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
  cancelled: [payload: { stepIndex?: number }];
  ask: [payload: { question: string }];
}

/** Format a tool result for the model, leading with an explicit OK/FAILED token
 * (small models miss a conditional trailing "Error:" line and hallucinate success). */
export function formatToolResult(tool: string, args: Record<string, unknown>, result: ToolResult): string {
  const status = result.success ? "OK" : "FAILED";
  let out = `[TOOL RESULT: ${tool} — ${status}] ${JSON.stringify(args)}\n`;
  if (result.exitCode !== undefined) out += `Exit: ${result.exitCode}\n`;
  if (result.data) {
    out += result.data.length > 6000 ? result.data.slice(0, 6000) + "\n…[truncated]" : result.data;
  }
  if (result.error) out += (result.data ? "\n---\n" : "") + `Error: ${result.error.slice(0, 1500)}`;
  if (!result.success) {
    out += `\n[This action did NOT succeed. Read the error, then fix the cause or try a different approach — do not claim it worked.]`;
  }
  return out;
}

export class AgentRuntime extends EventEmitter<AgentRuntimeEvents> {
  private readonly config: AgentConfig;
  private provider: Provider;
  /** The chat session that owns context, the active agent, model, cwd, and tool history. */
  readonly session: Session;
  private readonly tools: Map<string, Tool>;
  private readonly logger: SessionLogger;
  /** Cached native-tool-use capability of the active model (detected once per model). */
  private toolUseMode: boolean | undefined;
  /** True while a run/continueChat loop is in flight; gates cancel(). */
  private running = false;
  /** Set by cancel() to stop the loop cooperatively at the next checkpoint. */
  private cancelled = false;
  /** Whether the "that's a status, not a finished task" nudge has fired this run (cap: once). */
  private answerNudged = false;
  /** Whether a mutation tool actually ran this run (gates the verification step). */
  private mutationRan = false;
  /** Whether the pre-answer verification step has fired this run (cap: once). */
  private verifiedOnce = false;
  /** Whether the best-effort failure recovery turn has fired this run (cap: once). */
  private recoveredOnce = false;
  /** Interactive handler for the ask_user tool (provided by the TUI). */
  private askUserHandler?: (question: string) => Promise<string>;

  constructor(config: AgentConfig) {
    super();
    this.config = config;
    this.provider = createProvider(config.provider);
    this.session = new Session({
      agent: config.agent,
      model: config.provider.model,
      cwd: process.cwd(),
      maxTokens: config.maxContextTokens,
      onEvict: (evicted) => {
        this.emit("context:evict", { evicted, ratio: this.session.ctx.usage().ratio });
      },
      onUsage: (usage) => {
        this.emit("context:usage", { used: usage.total, max: usage.max, ratio: usage.ratio });
      },
    });
    this.logger = new SessionLogger(config.logDir);
    this.tools = new Map();
    for (const t of getDefaultTools()) {
      this.tools.set(t.definition.name, t);
    }
    // Prevent unhandled 'error' event crashes when no listener is attached
    this.on("error", () => {});
  }

  /** Conversation context, owned by the session. */
  private get ctx(): ContextManager { return this.session.ctx; }
  /** Active agent, owned by the session. */
  private get agent(): AgentDefinition | undefined { return this.session.agent; }

  /** Expose verbose flag so output layer can read it without a private cast */
  get verbose(): boolean { return this.config.verbose; }

  /** Active agent id (or "default" when unscoped). */
  get agentId(): string { return this.session.agentId; }

  /** Active model name. */
  get model(): string { return this.session.model; }

  /** Switch the active agent. Re-scopes permitted tools; the next initSession() rebuilds the prompt. */
  setAgent(def: AgentDefinition): void {
    this.session.setAgent(def);
  }

  /**
   * Cooperatively cancel an in-flight run/continueChat. The loop stops at its
   * next checkpoint and resolves with a cancelled outcome (emitting "cancelled").
   * A no-op when idle, and idempotent during a run.
   */
  cancel(): void {
    if (this.running) this.cancelled = true;
  }

  /** Emit the cancelled outcome and return the sentinel the loop resolves with. */
  private finishCancelled(stepIndex?: number): string {
    this.emit("cancelled", { stepIndex });
    return "[cancelled]";
  }

  /** Switch the model. Recreates the provider; tool-use capability is re-detected on the next run. */
  setModel(model: string): void {
    this.config.provider.model = model;
    this.session.model = model;
    this.provider = createProvider(this.config.provider);
    this.toolUseMode = undefined;
  }

  /** Register the interactive ask_user handler (resolves with the user's answer). */
  setAskUserHandler(fn: ((question: string) => Promise<string>) | undefined): void {
    this.askUserHandler = fn;
  }

  /** True if the active agent permits calling the named tool. */
  private isToolPermitted(name: string): boolean {
    if (name === "ask_user") return true; // clarification is allowed for every agent
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
    // ask_user can't be answered locally — route it to the interactive handler.
    if (name === "ask_user") {
      const question = String(args.question ?? "");
      this.session.recordTool("ask_user", args);
      this.emit("ask", { question });
      if (!this.askUserHandler) {
        return {
          success: true,
          data: "(No interactive user is available. Proceed with reasonable assumptions and state them explicitly.)",
        };
      }
      const answer = await this.askUserHandler(question);
      return { success: true, data: answer };
    }
    if (!this.isToolPermitted(name)) {
      const readonlyMutation = this.agent?.readonly === true && MUTATION_TOOLS.has(name);
      const error = readonlyMutation
        ? `Tool not permitted by active agent: ${name} changes the system and this is a read-only (plan) agent. Do NOT retry. Finish now by outputting your full plan as <answer> — describe this step in words; the user will hand it to the build agent to execute.`
        : "Tool not permitted by active agent";
      return { success: false, data: "", error };
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
      this.session.recordTool(name, args);
      if (MUTATION_TOOLS.has(name)) this.mutationRan = true;
      return await tool.execute(args);
    } catch (err: unknown) {
      return { success: false, data: "", error: toErrorMessage(err) };
    }
  }

  /** Initialise a persistent chat session. Call once before continueChat(). */
  initSession(): void {
    const cwd = process.cwd();
    this.ctx.clear();
    this.ctx.add({ role: "system", content: buildSystemPrompt(this.permittedTools(), cwd, this.agent?.systemPromptSuffix, this.config.skills, { fewShot: this.config.fewShot }) });
  }

  /**
   * Continue an existing chat session with a new user message.
   * Context from previous turns is preserved. Call initSession() first.
   */
  async continueChat(task: string): Promise<string> {
    const startTime = Date.now();
    this.ctx.add({ role: "user", content: task });
    await this.detectToolUse();
    await this.logger.init(task, this.session.model, process.cwd());
    this.emit("start", { task, model: this.session.model, cwd: process.cwd(), logPath: this.logger.filePath });
    return this.runLoop(startTime);
  }

  async run(task: string): Promise<string> {
    const cwd = process.cwd();
    const startTime = Date.now();

    this.ctx.clear();
    this.ctx.add({ role: "system", content: buildSystemPrompt(this.permittedTools(), cwd, this.agent?.systemPromptSuffix, this.config.skills, { fewShot: this.config.fewShot }) });
    this.ctx.add({ role: "user", content: task });

    await this.detectToolUse();
    await this.logger.init(task, this.session.model, cwd);
    this.emit("start", { task, model: this.session.model, cwd, logPath: this.logger.filePath });
    return this.runLoop(startTime);
  }

  /**
   * Hand the current session off to the build agent. Build's context is seeded
   * with the plan plus a deterministic compact summary of what the planning
   * phase examined (files read, commands run) — NOT the raw tool-result dumps.
   * Re-scopes tools and the system prompt to the build agent, then executes.
   */
  async handoffToBuild(buildAgent: AgentDefinition, planText: string): Promise<string> {
    const startTime = Date.now();
    const summary = this.session.examinedSummary();
    this.session.setAgent(buildAgent);
    const cwd = process.cwd();
    this.ctx.reset(buildSystemPrompt(this.permittedTools(), cwd, this.agent?.systemPromptSuffix, this.config.skills, { fewShot: this.config.fewShot }));
    this.ctx.add({
      role: "user",
      content: [
        "Implement this plan. Do exactly what it describes — create/edit the files and run the commands.",
        "",
        "## Plan",
        planText,
        "",
        "## Planning context (already explored — don't re-do this)",
        summary,
      ].join("\n"),
    });
    await this.detectToolUse();
    await this.logger.init("Implement the plan", this.session.model, cwd);
    this.emit("start", { task: "Implement the plan", model: this.session.model, cwd, logPath: this.logger.filePath });
    return this.runLoop(startTime);
  }

  private async runLoop(startTime: number): Promise<string> {
    this.running = true;
    this.cancelled = false;
    this.answerNudged = false;
    this.mutationRan = false;
    this.verifiedOnce = false;
    this.recoveredOnce = false;
    try {
      return await this.runLoopInner(startTime);
    } finally {
      this.running = false;
    }
  }

  private async runLoopInner(startTime: number): Promise<string> {
    const callCounts = new Map<string, number>();
    const recencyWindow: string[] = []; // last N tool names
    const failureCounts = new Map<string, number>(); // consecutive failures per tool
    let lastNudgeStep = -10;
    const useTools = this.toolUseMode === true;
    const toolSpecs = useTools ? this.toolSpecs() : undefined;

    for (let step = 1; step <= this.config.maxSteps; step++) {
      if (this.cancelled) return this.finishCancelled(step);
      this.emit("step", { index: step, total: this.config.maxSteps });

      let raw = "";
      let nativeCalls: ToolCall[] | undefined;
      for await (const chunk of this.provider.stream(this.ctx.forProvider(), toolSpecs)) {
        if (this.cancelled) break;
        raw += chunk.delta;
        if (chunk.delta) this.emit("chunk", { delta: chunk.delta, stepIndex: step });
        if (chunk.toolCalls && chunk.toolCalls.length > 0) nativeCalls = chunk.toolCalls;
      }
      if (this.cancelled) return this.finishCancelled(step);

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
        // Small models sometimes wrap a progress narration ("Next I'll edit…") in
        // <answer> and quit. On a build (non-readonly) run, nudge once to keep going
        // instead of accepting a status-shaped answer as final.
        if (
          !this.answerNudged &&
          step < this.config.maxSteps &&
          this.agent !== undefined &&
          !this.agent.readonly &&
          looksLikeMidTaskAnswer(parsed.answer)
        ) {
          this.answerNudged = true;
          this.ctx.add({
            role: "user",
            content:
              "That reads like a status update, not a finished task. Continue — actually perform the remaining steps with tools, verify the result, then give your final <answer> only once everything is done.",
          });
          continue;
        }
        // Verification gate: before accepting the first <answer> on a build run that
        // actually changed something, make the model confirm the work exists/works
        // with a tool instead of trusting a claim. Fires at most once per run.
        if (
          !this.verifiedOnce &&
          this.mutationRan &&
          step < this.config.maxSteps &&
          this.agent !== undefined &&
          !this.agent.readonly
        ) {
          this.verifiedOnce = true;
          this.ctx.add({
            role: "user",
            content:
              "[VERIFY] Before finishing, confirm the work actually happened: for each thing the task asked for, check it exists and is correct using a tool (read_file, bash ls/cat, or run_tests). If anything is missing or broken, fix it now. Then give your final <answer>.",
          });
          continue;
        }
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
          // Best-effort recovery: instead of a dead-end abort, give the model ONE
          // chance to change approach, ask the user, or summarise what it achieved.
          if (!this.recoveredOnce && step < this.config.maxSteps) {
            this.recoveredOnce = true;
            failureCounts.set(name, 0); // clear the streak so the recovery turn isn't aborted on entry
            this.ctx.add({
              role: "user",
              content: `[RECOVERY] ${name} has failed 3 times — stop repeating it. Do ONE of: (a) use a different tool or approach, (b) call ask_user if you are missing information, or (c) give an <answer> summarising what you accomplished and what remains. Do not call ${name} the same way again.`,
            });
            continue;
          }
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
