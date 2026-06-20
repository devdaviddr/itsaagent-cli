import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Session } from "../../src/agent/Session.js";
import { saveSessionTranscript } from "../../src/cli/saveTranscript.js";
import { parseChatInput } from "../../src/cli/chatCommands.js";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function session(): Session {
  const s = new Session({ model: "m", cwd: "/tmp", maxTokens: 8192 });
  s.ctx.add({ role: "system", content: "sys" });
  s.ctx.add({ role: "user", content: "hello there" });
  s.ctx.add({ role: "assistant", content: "<answer>hi</answer>" });
  return s;
}

describe("/save command parsing", () => {
  it("parses /save with no path", () => {
    expect(parseChatInput("/save")).toEqual({ kind: "save", path: "" });
  });
  it("parses /save with a path", () => {
    expect(parseChatInput("/save ~/notes/chat.md")).toEqual({ kind: "save", path: "~/notes/chat.md" });
  });
});

describe("saveSessionTranscript", () => {
  it("writes the full transcript to an explicit path", async () => {
    dir = mkdtempSync(join(tmpdir(), "iaa-save-"));
    const target = join(dir, "out", "chat.md");
    const written = await saveSessionTranscript(session(), target, undefined);
    expect(written).toBe(target);
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf-8")).toContain("hello there");
  });

  it("defaults to <logDir>/session-<id>-<stamp>.md", async () => {
    dir = mkdtempSync(join(tmpdir(), "iaa-save-"));
    const s = session();
    const written = await saveSessionTranscript(s, undefined, dir);
    expect(written.startsWith(dir)).toBe(true);
    expect(written).toContain(`session-${s.id}-`);
    expect(readdirSync(dir).length).toBe(1);
  });
});
