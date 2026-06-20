import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getGitContext, formatGitContext, gitStatusLine } from "../../src/agent/gitContext.js";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function initRepo(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "iaa-git-")));
  execFileSync("git", ["init", "-q"], { cwd: d });
  execFileSync("git", ["config", "user.email", "t@t.local"], { cwd: d });
  execFileSync("git", ["config", "user.name", "T"], { cwd: d });
  return d;
}

describe("getGitContext", () => {
  it("returns branch + changed files in a repo", () => {
    dir = initRepo();
    writeFileSync(join(dir, "a.txt"), "hi");
    const g = getGitContext(dir);
    expect(g).not.toBeNull();
    expect(g?.changedCount).toBeGreaterThan(0); // untracked a.txt
    expect(g?.branch.length).toBeGreaterThan(0);
  });

  it("reports clean + recent commits after a commit", () => {
    dir = initRepo();
    writeFileSync(join(dir, "a.txt"), "hi");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", "first commit"], { cwd: dir });
    const g = getGitContext(dir);
    expect(g?.changedCount).toBe(0);
    expect(g?.recentCommits.join("\n")).toContain("first commit");
  });

  it("returns null outside a git repo", () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "iaa-nogit-")));
    expect(getGitContext(dir)).toBeNull();
  });
});

describe("formatGitContext / gitStatusLine", () => {
  it("renders a prompt block and a status line", () => {
    const g = { branch: "main", changedCount: 2, changed: [" M a.ts", "?? b.ts"], recentCommits: ["abc fix: x"] };
    const block = formatGitContext(g);
    expect(block).toContain("## Git");
    expect(block).toContain("Branch: main");
    expect(block).toContain("2 changed file(s)");
    expect(block).toContain("fix: x");
    expect(gitStatusLine(g)).toBe("⎇ main · 2 changed");
    expect(gitStatusLine({ ...g, changedCount: 0, changed: [] })).toBe("⎇ main · clean");
  });
});
