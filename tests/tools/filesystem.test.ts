import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globTool, grepTool, readFileTool, writeFileTool } from "../../src/tools/filesystem.js";

const TEST_DIR = join(tmpdir(), `itsaagent-test-${process.pid}`);

beforeEach(async () => { await mkdir(TEST_DIR, { recursive: true }); });
afterEach(async () => { await rm(TEST_DIR, { recursive: true, force: true }); });

describe("readFileTool", () => {
  it("reads an existing file", async () => {
    const path = join(TEST_DIR, "hello.txt");
    await writeFile(path, "hello world", "utf-8");
    const result = await readFileTool.execute({ path });
    expect(result.success).toBe(true);
    expect(result.data).toBe("hello world");
  });

  it("returns error for missing file", async () => {
    const result = await readFileTool.execute({ path: join(TEST_DIR, "nope.txt") });
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("reads a line range with a range header", async () => {
    const path = join(TEST_DIR, "lines.txt");
    await writeFile(path, "one\ntwo\nthree\nfour\nfive", "utf-8");
    const result = await readFileTool.execute({ path, start_line: 2, end_line: 4 });
    expect(result.success).toBe(true);
    expect(result.data).toContain("[Lines 2–4 of 5");
    expect(result.data).toContain("two\nthree\nfour");
    expect(result.data).not.toContain("one");
    expect(result.data).not.toContain("five");
  });

  it("clamps end_line beyond EOF to the last line", async () => {
    const path = join(TEST_DIR, "short.txt");
    await writeFile(path, "a\nb\nc", "utf-8");
    const result = await readFileTool.execute({ path, start_line: 2, end_line: 99 });
    expect(result.success).toBe(true);
    expect(result.data).toContain("[Lines 2–3 of 3");
  });

  it("rejects start_line beyond EOF", async () => {
    const path = join(TEST_DIR, "tiny.txt");
    await writeFile(path, "a\nb", "utf-8");
    const result = await readFileTool.execute({ path, start_line: 10, end_line: 12 });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/out of range/);
  });

  it("rejects an oversized file read without a range", async () => {
    const path = join(TEST_DIR, "big.txt");
    await writeFile(path, "x".repeat(151 * 1024), "utf-8");
    const result = await readFileTool.execute({ path });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/too large to read whole/);
  });

  it("allows reading a range from an oversized file", async () => {
    const path = join(TEST_DIR, "big2.txt");
    const big = Array.from({ length: 6000 }, (_, i) => `line ${i + 1}`).join("\n");
    await writeFile(path, big, "utf-8");
    const result = await readFileTool.execute({ path, start_line: 1, end_line: 3 });
    expect(result.success).toBe(true);
    expect(result.data).toContain("line 1");
    expect(result.data).toContain("line 3");
    expect(result.data).not.toContain("line 4");
  });
});

describe("writeFileTool", () => {
  it("writes a file and reports byte count", async () => {
    const path = join(TEST_DIR, "out.txt");
    const result = await writeFileTool.execute({ path, content: "test content" });
    expect(result.success).toBe(true);
    expect(result.data).toContain("bytes");
  });

  it("creates parent directories automatically", async () => {
    const path = join(TEST_DIR, "nested", "deep", "file.txt");
    const result = await writeFileTool.execute({ path, content: "deep" });
    expect(result.success).toBe(true);
  });

  it("returns error for unwritable path", async () => {
    const result = await writeFileTool.execute({ path: "/root/forbidden.txt", content: "x" });
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe("globTool", () => {
  it("finds matching files", async () => {
    await writeFile(join(TEST_DIR, "a.ts"), "", "utf-8");
    await writeFile(join(TEST_DIR, "b.ts"), "", "utf-8");
    await writeFile(join(TEST_DIR, "c.txt"), "", "utf-8");
    const result = await globTool.execute({ pattern: "*.ts", cwd: TEST_DIR });
    expect(result.success).toBe(true);
    expect(result.data).toContain("a.ts");
    expect(result.data).toContain("b.ts");
    expect(result.data).not.toContain("c.txt");
  });

  it("returns (no matches) when nothing found", async () => {
    const result = await globTool.execute({ pattern: "*.xyz", cwd: TEST_DIR });
    expect(result.success).toBe(true);
    expect(result.data).toBe("(no matches)");
  });
});

describe("grepTool", () => {
  it("finds matching content in files", async () => {
    await writeFile(join(TEST_DIR, "code.ts"), "export const foo = 42;\n", "utf-8");
    const result = await grepTool.execute({ pattern: "foo", path: TEST_DIR });
    expect(result.success).toBe(true);
    expect(result.data).toContain("foo");
  });

  it("returns no matches for unmatched pattern", async () => {
    await writeFile(join(TEST_DIR, "file.ts"), "nothing here\n", "utf-8");
    const result = await grepTool.execute({ pattern: "zzz_definitely_not_present", path: TEST_DIR });
    expect(result.success).toBe(true);
    expect(result.data).toBe("no matches");
  });

  it("respects include glob filter", async () => {
    await writeFile(join(TEST_DIR, "match.ts"), "needle\n", "utf-8");
    await writeFile(join(TEST_DIR, "skip.md"), "needle\n", "utf-8");
    const result = await grepTool.execute({ pattern: "needle", path: TEST_DIR, include: "*.ts" });
    expect(result.success).toBe(true);
    expect(result.data).toContain("match.ts");
    expect(result.data).not.toContain("skip.md");
  });
});
