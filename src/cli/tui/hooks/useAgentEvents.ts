/**
 * Subscribe a conversation dispatcher to an AgentRuntime's event stream.
 *
 * Listeners are attached once and removed individually on cleanup — never via
 * removeAllListeners(), which would clobber every other subscriber (the old D-1
 * bug). All event→state mapping lives here, so there is exactly one wiring.
 */
import { useEffect } from "react";
import type { AgentRuntime } from "../../../agent/AgentRuntime.js";
import type { ToolResult } from "../../../types.js";
import type { ConvAction } from "../state/conversation.js";

export interface AgentEventHandlers {
  onUsage: (usage: { used: number; max: number; ratio: number }) => void;
  /** Fired on answer or error — the turn has ended. */
  onIdle: () => void;
}

export function useAgentEvents(
  runtime: AgentRuntime,
  dispatch: (action: ConvAction) => void,
  handlers: AgentEventHandlers,
): void {
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subs: Array<[string, (arg: any) => void]> = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const on = (event: string, fn: (arg: any) => void): void => {
      runtime.on(event as never, fn as never);
      subs.push([event, fn]);
    };

    on("step", ({ index }: { index: number }) => dispatch({ type: "step", index }));
    on("chunk", ({ delta }: { delta: string }) => dispatch({ type: "chunk", delta }));
    on("thought", ({ text, stepIndex }: { text: string; stepIndex: number }) =>
      dispatch({ type: "thought", text, stepIndex }),
    );
    on(
      "tool:call",
      ({ name, args, stepIndex }: { name: string; args: Record<string, unknown>; stepIndex: number }) =>
        dispatch({ type: "tool:call", name, args, stepIndex }),
    );
    on("tool:result", ({ result, stepIndex }: { result: ToolResult; stepIndex: number }) =>
      dispatch({ type: "tool:result", result, stepIndex }),
    );
    on("context:usage", (u: { used: number; max: number; ratio: number }) => handlers.onUsage(u));
    on("answer", ({ text }: { text: string }) => {
      dispatch({ type: "answer", text });
      handlers.onIdle();
    });
    on("error", ({ error }: { error: { message: string } }) => {
      dispatch({ type: "error", text: error.message });
      handlers.onIdle();
    });
    on("cancelled", () => {
      dispatch({ type: "notice", text: "Cancelled." });
      handlers.onIdle();
    });

    return () => {
      for (const [event, fn] of subs) runtime.off(event as never, fn as never);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
