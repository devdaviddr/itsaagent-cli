/**
 * Conversation state for the persistent TUI: the canonical model the message log
 * renders. A single pure reducer turns the AgentRuntime event stream into an
 * ordered list of entries, so there is exactly one event→state mapping (no more
 * duplicated wiring between AgentView and a dead hook).
 *
 * Streaming is bounded: only the in-flight step buffers raw deltas in `live`,
 * which is reset at every step/thought/answer boundary — finalised entries hold
 * their complete text, never a growing whole-run concatenation.
 */
import type { ToolResult } from "../../../types.js";

export type EntryKind = "user" | "thought" | "tool" | "answer" | "error" | "notice";

export interface UserEntry {
  id: number;
  kind: "user";
  text: string;
}
export interface ThoughtEntry {
  id: number;
  kind: "thought";
  text: string;
  stepIndex: number;
}
export interface ToolEntry {
  id: number;
  kind: "tool";
  stepIndex: number;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "success" | "error";
  result?: ToolResult;
  /** Whether the block shows full args/result (vs the collapsed summary). */
  expanded: boolean;
}
export interface AnswerEntry {
  id: number;
  kind: "answer";
  text: string;
}
export interface ErrorEntry {
  id: number;
  kind: "error";
  text: string;
}
export interface NoticeEntry {
  id: number;
  kind: "notice";
  text: string;
}

export type Entry =
  | UserEntry
  | ThoughtEntry
  | ToolEntry
  | AnswerEntry
  | ErrorEntry
  | NoticeEntry;

export interface ConversationState {
  entries: Entry[];
  nextId: number;
  /** Bounded live buffer for the streaming step in flight; reset on every boundary. */
  live: string;
  /** Whether the view auto-follows the tail (vs being scrolled up). */
  following: boolean;
  /** Lines scrolled up from the tail when paused (following === false). */
  scrollOffset: number;
}

export function initialConversation(): ConversationState {
  return { entries: [], nextId: 1, live: "", following: true, scrollOffset: 0 };
}

/**
 * The most recent answer in the transcript — the plan text used when handing
 * off from `plan` to `build` (Tab in the TUI). Returns "" when there is none.
 * Shared so the handoff capture path is testable without rendering the TUI.
 */
export function lastAnswer(entries: Entry[]): string {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.kind === "answer") return e.text;
  }
  return "";
}

export type ConvAction =
  | { type: "user"; text: string }
  | { type: "step"; index: number }
  | { type: "chunk"; delta: string }
  | { type: "thought"; text: string; stepIndex: number }
  | { type: "tool:call"; name: string; args: Record<string, unknown>; stepIndex: number }
  | { type: "tool:result"; result: ToolResult; stepIndex: number }
  | { type: "answer"; text: string }
  | { type: "error"; text: string }
  | { type: "notice"; text: string }
  | { type: "reset" }
  | { type: "toggleExpand"; id: number }
  | { type: "toggleExpandAll"; expanded: boolean }
  | { type: "scrollUp"; lines: number }
  | { type: "scrollDown"; lines: number }
  | { type: "scrollToTail" };

/** Distributive omit so each entry variant keeps its own fields (a plain Omit<Entry,"id"> collapses the union). */
type NewEntry = Entry extends infer T ? (T extends Entry ? Omit<T, "id"> : never) : never;

/** Append an entry, assigning the next id. Scroll position is left to the caller's prior reset. */
function append(state: ConversationState, entry: NewEntry): ConversationState {
  const withId = { ...entry, id: state.nextId } as Entry;
  return { ...state, entries: [...state.entries, withId], nextId: state.nextId + 1 };
}

export function conversationReducer(
  state: ConversationState,
  action: ConvAction,
): ConversationState {
  switch (action.type) {
    case "user":
      return append({ ...state, live: "" }, { kind: "user", text: action.text });

    case "step":
      // New step boundary: discard any partial live buffer from the previous step.
      return { ...state, live: "" };

    case "chunk":
      return { ...state, live: state.live + action.delta };

    case "thought":
      // Finalise the streaming buffer into a structured thought entry.
      return append(
        { ...state, live: "" },
        { kind: "thought", text: action.text, stepIndex: action.stepIndex },
      );

    case "tool:call":
      return append(
        { ...state, live: "" },
        {
          kind: "tool",
          stepIndex: action.stepIndex,
          name: action.name,
          args: action.args,
          status: "running",
          expanded: false,
        },
      );

    case "tool:result": {
      // Attach to the most recent still-running tool entry for this step.
      const entries = [...state.entries];
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e.kind === "tool" && e.stepIndex === action.stepIndex && e.status === "running") {
          entries[i] = {
            ...e,
            status: action.result.success ? "success" : "error",
            result: action.result,
          };
          break;
        }
      }
      return { ...state, entries };
    }

    case "answer":
      return append({ ...state, live: "" }, { kind: "answer", text: action.text });

    case "error":
      return append({ ...state, live: "" }, { kind: "error", text: action.text });

    case "notice":
      return append(state, { kind: "notice", text: action.text });

    case "reset":
      // Wipe the visible transcript entirely (used by /clear).
      return initialConversation();

    case "toggleExpand":
      return {
        ...state,
        entries: state.entries.map((e) =>
          e.kind === "tool" && e.id === action.id ? { ...e, expanded: !e.expanded } : e,
        ),
      };

    case "toggleExpandAll":
      return {
        ...state,
        entries: state.entries.map((e) =>
          e.kind === "tool" ? { ...e, expanded: action.expanded } : e,
        ),
      };

    case "scrollUp":
      return { ...state, following: false, scrollOffset: state.scrollOffset + action.lines };

    case "scrollDown": {
      const offset = Math.max(0, state.scrollOffset - action.lines);
      return { ...state, scrollOffset: offset, following: offset === 0 };
    }

    case "scrollToTail":
      return { ...state, scrollOffset: 0, following: true };

    default:
      return state;
  }
}
