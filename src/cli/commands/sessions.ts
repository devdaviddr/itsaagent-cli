import chalk from "chalk";
import type { Command } from "commander";
import { SessionStore } from "../../agent/SessionStore.js";
import { SESSIONS_DIR } from "../config.js";

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function registerSessionsCommand(program: Command): void {
  program
    .command("sessions")
    .description("List saved chat sessions (resume one with `iaa chat --resume <id>`)")
    .action(async () => {
      const list = await new SessionStore(SESSIONS_DIR).list();
      if (list.length === 0) {
        console.error(chalk.dim("No saved sessions yet. Start one with `iaa chat`."));
        return;
      }
      for (const s of list) {
        const turns = s.messages.filter((m) => m.role === "user" && !m.content.startsWith("[TOOL RESULT")).length;
        console.log(
          `${chalk.cyan(s.id)}  ${chalk.dim(ago(s.updatedAt).padStart(7))}  ${chalk.dim(`${s.agentId}/${s.model}`)}  ${turns} turn${turns === 1 ? "" : "s"}`,
        );
        console.log(`  ${s.title}`);
      }
      console.error(chalk.dim(`\nResume: iaa chat --resume <id>  (or just --resume for the latest)`));
    });
}
