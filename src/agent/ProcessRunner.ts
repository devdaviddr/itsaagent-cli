import type { AgentRuntime } from "./AgentRuntime.js";
import type { AgentRegistry } from "./AgentRegistry.js";
import { stageAgent, type ProcessDef } from "./Process.js";

export interface ProcessHooks {
  /** Called as each stage begins, with its 0-based index, label, and agent id. */
  onStage?: (index: number, label: string, agentId: string) => void;
}

/**
 * Run an advised process end-to-end on a single session: the first stage runs
 * the task with its agent, and each subsequent stage is auto-advanced via the
 * runtime's handoff (seeded with the previous stage's answer plus the compact
 * "already explored" summary). Returns the final stage's answer.
 *
 * This is the headless equivalent of the TUI's plan→build Tab handoff — the
 * pipeline runs unattended instead of waiting for a keypress.
 */
export async function runProcess(
  runtime: AgentRuntime,
  registry: AgentRegistry,
  proc: ProcessDef,
  task: string,
  hooks?: ProcessHooks,
): Promise<string> {
  if (proc.stages.length === 0) throw new Error(`Process "${proc.id}" has no stages`);

  const firstId = stageAgent(proc, 0);
  const first = registry.get(firstId);
  if (!first) throw new Error(`Process "${proc.id}" stage 1 references unknown agent "${firstId}"`);

  runtime.setAgent(first);
  hooks?.onStage?.(0, proc.stages[0].label, first.id);
  let result = await runtime.run(task);

  for (let i = 1; i < proc.stages.length; i++) {
    const id = stageAgent(proc, i);
    const def = registry.get(id);
    if (!def) throw new Error(`Process "${proc.id}" stage ${i + 1} references unknown agent "${id}"`);
    hooks?.onStage?.(i, proc.stages[i].label, def.id);
    result = await runtime.handoffToBuild(def, result);
  }

  return result;
}
