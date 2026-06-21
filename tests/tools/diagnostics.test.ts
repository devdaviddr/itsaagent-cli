import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkDiagnostics } from "../../src/tools/verify.js";

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "iaa-diag-")));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("checkDiagnostics", () => {
  it("returns null for an unknown file type", async () => {
    const f = join(dir, "notes.txt");
    writeFileSync(f, "hello");
    expect(await checkDiagnostics(f, dir)).toBeNull();
  });

  it("returns null for TS when no local tsc is available (never falls back to node --check)", async () => {
    const f = join(dir, "thing.ts");
    writeFileSync(f, "const x: number = 1;\n");
    // dir has no node_modules/.bin/tsc → must be null, NOT a node --check false-fail.
    expect(await checkDiagnostics(f, dir)).toBeNull();
  });

  it("uses a local tsc when present (parent lookup up to 3 levels)", async () => {
    // Fake a local tsc that always exits 0 and prints nothing.
    const bin = join(dir, "node_modules", ".bin");
    mkdirSync(bin, { recursive: true });
    const tsc = join(bin, "tsc");
    writeFileSync(tsc, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const f = join(dir, "ok.ts");
    writeFileSync(f, "const x = 1;\n");
    const out = await checkDiagnostics(f, dir);
    expect(out).toBe("Diagnostics (tsc): PASS");
  });

  it("finds local tsc from a nested cwd (parent walk)", async () => {
    const bin = join(dir, "node_modules", ".bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "tsc"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const nested = join(dir, "src", "deep");
    mkdirSync(nested, { recursive: true });
    const f = join(nested, "a.ts");
    writeFileSync(f, "const a = 1;\n");
    expect(await checkDiagnostics(f, nested)).toBe("Diagnostics (tsc): PASS");
  });

  it("surfaces tsc diagnostics (capped) when the check fails", async () => {
    const bin = join(dir, "node_modules", ".bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "tsc"), "#!/bin/sh\necho 'a.ts(1,7): error TS2322: bad'\nexit 1\n", { mode: 0o755 });
    const f = join(dir, "bad.ts");
    writeFileSync(f, "const x: number = 'no';\n");
    const out = await checkDiagnostics(f, dir);
    expect(out).toMatch(/Diagnostics \(tsc\):/);
    expect(out).toMatch(/TS2322/);
  });

  it("falls back to a parse check for .js when no local eslint exists", async () => {
    const f = join(dir, "ok.js");
    writeFileSync(f, "const a = 1;\nconsole.log(a);\n");
    const out = await checkDiagnostics(f, dir);
    // node --check fallback → parse PASS
    expect(out).toBe("Syntax: PASS");
  });

  it("never throws on a missing file (returns a diagnostic, not an exception)", async () => {
    const f = join(dir, "nope.js");
    // No file written; node --check will fail but must be caught.
    const out = await checkDiagnostics(f, dir);
    expect(out === null || /Syntax: FAILED/.test(out)).toBe(true);
  });
});
