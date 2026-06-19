import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gitTool, tokenizeArgs } from "../../src/tools/git.js";

const execFileAsync = promisify(execFile);
const REPO = join(tmpdir(), `itsaagent-git-${process.pid}`);

beforeEach(async () => {
  await mkdir(REPO, { recursive: true });
  await execFileAsync("git", ["init"], { cwd: REPO });
  await execFileAsync("git", ["config", "user.email", "test@test.com"], { cwd: REPO });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: REPO });
});
afterEach(async () => { await rm(REPO, { recursive: true, force: true }); });

describe("tokenizeArgs", () => {
  it("respects double quotes around a commit message", () => {
    expect(tokenizeArgs('-m "fix: a typo"')).toEqual(["-m", "fix: a typo"]);
  });
  it("splits unquoted args on whitespace", () => {
    expect(tokenizeArgs("--staged --stat")).toEqual(["--staged", "--stat"]);
  });
});

describe("gitTool", () => {
  it("git status returns output", async () => {
    const result = await gitTool.execute({ subcommand: "status", cwd: REPO });
    expect(result.success).toBe(true);
    expect(result.data.length).toBeGreaterThan(0);
  });

  it("git add stages a file", async () => {
    await writeFile(join(REPO, "f.txt"), "hi", "utf-8");
    const add = await gitTool.execute({ subcommand: "add", args: "f.txt", cwd: REPO });
    expect(add.success).toBe(true);
    const status = await gitTool.execute({ subcommand: "status", args: "--short", cwd: REPO });
    expect(status.data).toContain("f.txt");
  });

  it("git commit -m creates a commit", async () => {
    await writeFile(join(REPO, "f.txt"), "hi", "utf-8");
    await gitTool.execute({ subcommand: "add", args: "f.txt", cwd: REPO });
    const commit = await gitTool.execute({ subcommand: "commit", args: '-m "initial commit"', cwd: REPO });
    expect(commit.success).toBe(true);
    const log = await gitTool.execute({ subcommand: "log", args: "--oneline", cwd: REPO });
    expect(log.data).toContain("initial commit");
  });

  it("blocks a non-allowed subcommand without executing", async () => {
    const result = await gitTool.execute({ subcommand: "reset", args: "--hard", cwd: REPO });
    expect(result.success).toBe(false);
    expect(result.error).toBe("subcommand not permitted");
  });

  it("rejects commit without -m before running git", async () => {
    const result = await gitTool.execute({ subcommand: "commit", args: "--amend", cwd: REPO });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/requires a message/);
  });
});
