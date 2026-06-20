import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bashTool } from "../../src/tools/bash.js";
import { getSessionCwd, resetSessionCwd } from "../../src/tools/session.js";

describe("bashTool", () => {
  it("runs a simple command and returns stdout", async () => {
    const result = await bashTool.execute({ command: "echo hello" });
    expect(result.success).toBe(true);
    expect(result.data.trim()).toBe("hello");
    expect(result.exitCode).toBe(0);
  });

  it("returns exitCode 1 and error on failure", async () => {
    const result = await bashTool.execute({ command: "exit 1" });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it("returns stderr in error field", async () => {
    const result = await bashTool.execute({ command: "ls /nonexistent_path_xyz" });
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("coerces non-string command arg", async () => {
    const result = await bashTool.execute({ command: 123 });
    // Should run "123" as a command and fail, not throw
    expect(result).toHaveProperty("success");
  });

  it("returns stdout even on non-zero exit", async () => {
    const result = await bashTool.execute({ command: "echo output; exit 2" });
    expect(result.data.trim()).toBe("output");
    expect(result.exitCode).toBe(2);
  });
});

describe("bashTool cwd (fixes npm-writes-to-home)", () => {
  afterEach(() => resetSessionCwd());

  it("runs the command in the given cwd, not the home directory", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "iaa-bashcwd-")));
    try {
      const result = await bashTool.execute({ command: "pwd", cwd: dir });
      expect(result.success).toBe(true);
      expect(result.data.trim()).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does NOT persist an explicit cwd (one-off, avoids compounding relative dirs)", async () => {
    const before = getSessionCwd();
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "iaa-bashcwd-")));
    try {
      await bashTool.execute({ command: "true", cwd: dir });
      expect(getSessionCwd()).toBe(before); // session cwd unchanged
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("still persists a `cd` inside the command (no explicit cwd)", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "iaa-bashcd-")));
    try {
      await bashTool.execute({ command: `cd ${dir}` });
      expect(getSessionCwd()).toBe(dir);
    } finally {
      resetSessionCwd();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("errors clearly when the cwd does not exist", async () => {
    const result = await bashTool.execute({ command: "pwd", cwd: join(tmpdir(), "iaa-does-not-exist-xyz") });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/does not exist or is not a directory/i);
  });
});
