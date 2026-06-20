import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTestsTool, detectTestCommand } from "../../src/tools/verify.js";
import { setSessionCwd, resetSessionCwd } from "../../src/tools/session.js";

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "iaa-verify-")));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  resetSessionCwd();
});

describe("detectTestCommand", () => {
  it("uses npm test for a package.json with a real test script", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
    expect(detectTestCommand(dir)).toBe("npm test");
  });

  it("uses pnpm test when a pnpm lockfile is present", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
    writeFileSync(join(dir, "pnpm-lock.yaml"), "");
    expect(detectTestCommand(dir)).toBe("pnpm test");
  });

  it("ignores the npm-init default 'no test specified' script", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }));
    expect(detectTestCommand(dir)).toBeNull();
  });

  it("detects cargo, pytest (by test file), and make test", () => {
    const a = realpathSync(mkdtempSync(join(tmpdir(), "iaa-cargo-")));
    writeFileSync(join(a, "Cargo.toml"), "[package]");
    expect(detectTestCommand(a)).toBe("cargo test");
    rmSync(a, { recursive: true, force: true });

    writeFileSync(join(dir, "test_app.py"), "def test_x(): pass");
    expect(detectTestCommand(dir)).toBe("pytest");
  });

  it("returns null when nothing is detected", () => {
    expect(detectTestCommand(dir)).toBeNull();
  });
});

describe("runTestsTool", () => {
  it("reports PASS for a passing command (override)", async () => {
    setSessionCwd(dir);
    const r = await runTestsTool.execute({ command: "exit 0" });
    expect(r.success).toBe(true);
    expect(r.data).toContain("PASS");
  });

  it("reports FAIL for a failing command (override)", async () => {
    setSessionCwd(dir);
    const r = await runTestsTool.execute({ command: "echo boom; exit 1" });
    expect(r.success).toBe(false);
    expect(r.data).toContain("FAIL");
    expect(r.data).toContain("boom");
  });

  it("errors clearly when no test runner is detected", async () => {
    setSessionCwd(dir); // empty dir
    const r = await runTestsTool.execute({});
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/no test runner detected/i);
  });

  it("runs in the session cwd", async () => {
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "marker.txt"), "x");
    setSessionCwd(join(dir, "sub"));
    const r = await runTestsTool.execute({ command: "test -f marker.txt && echo ok" });
    expect(r.success).toBe(true);
    expect(r.data).toContain("ok");
  });
});
