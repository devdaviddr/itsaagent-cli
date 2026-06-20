import type { Session } from "./Session.js";
import type { Message } from "../types.js";

function ts(ms: number): string {
  // Local ISO-ish timestamp without forcing a timezone library.
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Label a context message for the transcript by role/shape. */
function heading(msg: Message): string {
  if (msg.role === "system") return "System prompt";
  if (msg.role === "assistant") return "Assistant";
  if (msg.notice) return "Context notice";
  if (msg.role === "user" && msg.content.startsWith("[TOOL RESULT")) return "Tool result";
  if (msg.role === "user") return "User";
  return msg.role;
}

/**
 * Render the FULL current session as a Markdown transcript: metadata, every
 * agent transition, and every message in context in order (user turns,
 * assistant replies, tool results, notices, and the system prompt). This is the
 * literal session history the model sees, not a summary.
 */
export function formatSessionTranscript(session: Session): string {
  const messages = session.ctx.get();
  const usage = session.ctx.usage();
  const out: string[] = [];

  out.push(`# ItsAAgent session transcript`);
  out.push("");
  out.push(`- **Session:** ${session.id}${session.title && session.title !== "Untitled session" ? ` — ${session.title}` : ""}`);
  out.push(`- **Created:** ${ts(session.createdAt)}`);
  out.push(`- **Saved:** ${ts(Date.now())}`);
  out.push(`- **Model:** \`${session.model}\``);
  out.push(`- **Active agent:** \`${session.agentId}\``);
  out.push(`- **Messages:** ${messages.length} · **context ~${usage.total}/${usage.max} tokens (${usage.ratio}%)**`);
  out.push(`- **Tool calls:** ${session.toolHistory.length}`);
  if (session.transitions.length) {
    const path = [session.transitions[0].from ?? "?", ...session.transitions.map((t) => t.to)].join(" → ");
    out.push(`- **Agent path:** ${path}`);
  }
  out.push("");
  out.push("---");
  out.push("");

  if (messages.length === 0) {
    out.push("_(empty session — no messages yet)_");
    return out.join("\n") + "\n";
  }

  messages.forEach((msg, i) => {
    out.push(`## ${i + 1}. ${heading(msg)}  ${msg.timestamp ? `_(${ts(msg.timestamp)})_` : ""}`.trimEnd());
    out.push("");
    out.push(msg.content.length > 0 ? msg.content : "_(empty)_");
    out.push("");
  });

  return out.join("\n") + "\n";
}
