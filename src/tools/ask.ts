import type { Tool } from "../types.js";

/**
 * `ask_user` — a clarification primitive. The model calls it to ask the user a
 * question and receive their answer as the tool result. The runtime intercepts
 * this tool (it can't be answered locally) and routes it to an interactive
 * handler; this `execute()` is only the fallback for non-interactive runs.
 */
export const askUserTool: Tool = {
  definition: {
    name: "ask_user",
    description:
      "Ask the user a clarifying question and wait for their answer. Use this when the request is ambiguous or needs information only the user has — ask instead of guessing. Returns the user's reply.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The single, specific question to ask the user" },
      },
      required: ["question"],
    },
  },
  async execute(): Promise<{ success: boolean; data: string }> {
    // Only reached when there is no interactive user (e.g. piped `iaa run`).
    return {
      success: true,
      data: "(No interactive user is available. Proceed with reasonable assumptions and state them explicitly in your answer.)",
    };
  },
};
