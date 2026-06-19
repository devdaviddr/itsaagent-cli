/** Pure parser for chat input — separates slash commands from ordinary messages. */

export type ChatCommand =
  | { kind: "message"; text: string }
  | { kind: "exit" }
  | { kind: "clear" }
  | { kind: "help" }
  | { kind: "agents" }
  | { kind: "agent"; name: string }
  | { kind: "model"; name: string }
  | { kind: "unknown"; cmd: string };

export function parseChatInput(input: string): ChatCommand {
  const t = input.trim();
  if (!t.startsWith("/")) return { kind: "message", text: input };

  const [cmd, ...rest] = t.slice(1).split(/\s+/);
  const arg = rest.join(" ").trim();
  switch (cmd.toLowerCase()) {
    case "exit":
    case "quit":
      return { kind: "exit" };
    case "clear":
      return { kind: "clear" };
    case "help":
      return { kind: "help" };
    case "agents":
      return { kind: "agents" };
    case "agent":
      return { kind: "agent", name: arg };
    case "model":
      return { kind: "model", name: arg };
    default:
      return { kind: "unknown", cmd };
  }
}

export const CHAT_HELP = [
  "Slash commands:",
  "  /agent <name>   switch agent (resets context)",
  "  /agents         list available agents",
  "  /model <name>   switch model (persists)",
  "  /clear          reset the conversation",
  "  /help           show this help",
  "  /exit           leave chat",
].join("\n");
