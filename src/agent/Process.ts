/**
 * An advised process: a reusable, ordered sequence of stages over a session,
 * each stage bound to an agent and advanced by a user-confirmed transition.
 * v0.6.0 ships one built-in process (`guided`); the shape accepts a markdown
 * loader later (deferred).
 */
export interface ProcessStage {
  /** Agent id active during this stage. */
  agent: string;
  /** Short label for the status line. */
  label: string;
}

export interface ProcessDef {
  id: string;
  title: string;
  description: string;
  stages: ProcessStage[];
}

/** The built-in guided process: plan the work, then hand off to build to execute. */
export const GUIDED_PROCESS: ProcessDef = {
  id: "guided",
  title: "Guided build",
  description:
    "Plan the work (the plan agent may ask you to clarify ambiguities), then press Tab to hand it off to the build agent to execute.",
  stages: [
    { agent: "plan", label: "plan" },
    { agent: "build", label: "build" },
  ],
};

export const BUILTIN_PROCESSES: ProcessDef[] = [GUIDED_PROCESS];

export function getProcess(id: string): ProcessDef | undefined {
  return BUILTIN_PROCESSES.find((p) => p.id === id);
}

/** The next stage index, or `null` when the process is on its final stage. */
export function nextStageIndex(proc: ProcessDef, current: number): number | null {
  return current + 1 < proc.stages.length ? current + 1 : null;
}

/** The agent id for a given stage (clamped to the valid range). */
export function stageAgent(proc: ProcessDef, index: number): string {
  const i = Math.max(0, Math.min(index, proc.stages.length - 1));
  return proc.stages[i].agent;
}
