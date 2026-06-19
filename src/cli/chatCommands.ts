/** Pure parser for chat input — separates slash commands from ordinary messages. */

export type ChatCommand =
  | { kind: "message"; text: string }
  | { kind: "exit" }
  | { kind: "clear" }
  | { kind: "help" }
  | { kind: "agents" }
  | { kind: "agent"; name: string }
  | { kind: "model"; name: string }
  | { kind: "models" }
  | { kind: "theme"; name: string }
  | { kind: "tools" }
  | { kind: "about" }
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
    case "models":
      return { kind: "models" };
    case "theme":
      return { kind: "theme", name: arg };
    case "tools":
      return { kind: "tools" };
    case "about":
    case "version":
    case "license":
    case "licence":
      return { kind: "about" };
    default:
      return { kind: "unknown", cmd };
  }
}

export interface CommandMeta {
  name: string;
  /** Argument placeholder shown in autocomplete, e.g. "<name>". */
  arg?: string;
  help: string;
}

/** All slash commands, in display order. Drives autocomplete and /help. */
export const COMMANDS: CommandMeta[] = [
  { name: "help", help: "show commands" },
  { name: "agent", arg: "<name>", help: "switch agent (resets context)" },
  { name: "agents", help: "list agents" },
  { name: "model", arg: "<name>", help: "switch model (persists)" },
  { name: "models", help: "list available models" },
  { name: "theme", arg: "<name>", help: "switch theme (persists)" },
  { name: "tools", help: "list tools" },
  { name: "about", help: "version, licence, author" },
  { name: "clear", help: "reset the conversation" },
  { name: "exit", help: "leave" },
];

/**
 * Autocomplete matches for the current input. Returns command suggestions only
 * while the command name is still being typed (before the first space), so the
 * popup disappears once the user moves on to arguments.
 */
export function matchCommands(input: string): CommandMeta[] {
  const t = input.trimStart();
  if (!t.startsWith("/")) return [];
  if (/\s/.test(t.trim())) return [];
  const partial = t.slice(1).toLowerCase();
  return COMMANDS.filter((c) => c.name.startsWith(partial));
}

export const CHAT_HELP = [
  "Slash commands:",
  "  /agent <name>   switch agent (resets context)",
  "  /agents         list available agents",
  "  /model <name>   switch model (persists)",
  "  /models         list available models",
  "  /theme <name>   switch theme (persists)",
  "  /tools          list tools",
  "  /about          version, licence, and author",
  "  /clear          reset the conversation",
  "  /help           show this help",
  "  /exit           leave chat",
].join("\n");
