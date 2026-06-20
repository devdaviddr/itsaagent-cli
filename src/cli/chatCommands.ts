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
  | { kind: "guided"; task: string }
  | { kind: "save"; path: string }
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
    case "guided":
      return { kind: "guided", task: arg };
    case "save":
      return { kind: "save", path: arg };
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

/**
 * Slash commands shown in the autocomplete palette, in display order. The
 * arg-taking ones open a picker modal. The plural list variants (/agents,
 * /models) are intentionally omitted here — their modal already lists
 * everything — but remain typeable via {@link parseChatInput}.
 */
export const COMMANDS: CommandMeta[] = [
  { name: "help", help: "show commands" },
  { name: "agent", help: "switch agent — opens a picker" },
  { name: "model", help: "switch model — opens a picker" },
  { name: "theme", help: "switch theme — opens a picker" },
  { name: "guided", arg: "<task>", help: "plan a task, then Tab to hand off to build" },
  { name: "save", arg: "[path]", help: "save the full session transcript to a file" },
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
  "  /agent          switch agent — opens a picker (resets context)",
  "  /model          switch model — opens a picker (persists)",
  "  /theme          switch theme — opens a picker (persists)",
  "  /guided <task>  plan a task (clarify ambiguities), then Tab → build",
  "  /save [path]    save the full session transcript to a file (default: log dir)",
  "  /tools          list tools",
  "  /about          version, licence, and author",
  "  /clear          reset the conversation",
  "  /help           show this help",
  "  /exit           leave chat",
  "",
  "Also typeable: /agent <name>, /model <name>, /theme <name>, /agents, /models",
].join("\n");
