import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Session, SerializedSession } from "./Session.js";

/**
 * Disk persistence for chat sessions. Each session is one JSON file named by id,
 * so a chat can be saved continuously and resumed later (`iaa chat --resume`).
 */
export class SessionStore {
  constructor(private readonly dir: string) {}

  private fileFor(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  /** Persist the current state of a session (id-named JSON). */
  async save(session: Session): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.fileFor(session.id), JSON.stringify(session.toJSON(), null, 2), "utf-8");
  }

  /** Load a session by id, or undefined if missing/unreadable. */
  async load(id: string): Promise<SerializedSession | undefined> {
    try {
      return JSON.parse(await readFile(this.fileFor(id), "utf-8")) as SerializedSession;
    } catch {
      return undefined;
    }
  }

  /** All saved sessions, newest-updated first. */
  async list(): Promise<SerializedSession[]> {
    let names: string[];
    try {
      names = (await readdir(this.dir)).filter((n) => n.endsWith(".json"));
    } catch {
      return [];
    }
    const sessions: SerializedSession[] = [];
    for (const name of names) {
      try {
        sessions.push(JSON.parse(await readFile(join(this.dir, name), "utf-8")) as SerializedSession);
      } catch {
        // skip corrupt files
      }
    }
    return sessions.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  }

  /** The id of the most recently updated session, or undefined. */
  async latestId(): Promise<string | undefined> {
    return (await this.list())[0]?.id;
  }
}
