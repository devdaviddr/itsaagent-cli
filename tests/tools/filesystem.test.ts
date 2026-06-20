import { mkdir, rm, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  globTool,
  grepTool,
  readFileTool,
  writeFileTool,
  appendFileTool,
  editFileTool,
  deleteFileTool,
  downloadFileTool,
} from "../../src/tools/filesystem.js";

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

describe("appendFileTool", () => {
  it("appends to an existing file without modifying prior content", async () => {
    const path = join(TEST_DIR, "log.txt");
    await writeFile(path, "line1\n", "utf-8");
    const result = await appendFileTool.execute({ path, content: "line2\n" });
    expect(result.success).toBe(true);
    expect(await readFile(path, "utf-8")).toBe("line1\nline2\n");
  });

  it("creates the file if it does not exist", async () => {
    const path = join(TEST_DIR, "new.txt");
    const result = await appendFileTool.execute({ path, content: "hello" });
    expect(result.success).toBe(true);
    expect(await readFile(path, "utf-8")).toBe("hello");
  });

  it("creates parent directories", async () => {
    const path = join(TEST_DIR, "a", "b", "c.txt");
    const result = await appendFileTool.execute({ path, content: "x" });
    expect(result.success).toBe(true);
  });

  it("reports appended byte count and new total", async () => {
    const path = join(TEST_DIR, "count.txt");
    await writeFile(path, "ab", "utf-8");
    const result = await appendFileTool.execute({ path, content: "cde" });
    expect(result.data).toContain("3 bytes");
    expect(result.data).toContain("5 bytes total");
  });
});

describe("editFileTool", () => {
  it("replaces a line range and returns a diff", async () => {
    const path = join(TEST_DIR, "edit.txt");
    await writeFile(path, "a\nb\nc\nd", "utf-8");
    const result = await editFileTool.execute({ path, start_line: 2, end_line: 3, new_content: "X\nY" });
    expect(result.success).toBe(true);
    expect(await readFile(path, "utf-8")).toBe("a\nX\nY\nd");
    expect(result.data).toContain("-b");
    expect(result.data).toContain("+X");
  });

  it("inserts without removing when end = start - 1", async () => {
    const path = join(TEST_DIR, "ins.txt");
    await writeFile(path, "a\nb\nc", "utf-8");
    const result = await editFileTool.execute({ path, start_line: 2, end_line: 1, new_content: "NEW" });
    expect(result.success).toBe(true);
    expect(await readFile(path, "utf-8")).toBe("a\nNEW\nb\nc");
  });

  it("deletes lines when new_content is empty", async () => {
    const path = join(TEST_DIR, "del.txt");
    await writeFile(path, "a\nb\nc", "utf-8");
    const result = await editFileTool.execute({ path, start_line: 2, end_line: 2, new_content: "" });
    expect(result.success).toBe(true);
    expect(await readFile(path, "utf-8")).toBe("a\nc");
  });

  it("fails on missing file", async () => {
    const result = await editFileTool.execute({ path: join(TEST_DIR, "nope.txt"), start_line: 1, end_line: 1, new_content: "x" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No such file/);
  });

  it("fails on out-of-range lines", async () => {
    const path = join(TEST_DIR, "range.txt");
    await writeFile(path, "a\nb", "utf-8");
    const result = await editFileTool.execute({ path, start_line: 5, end_line: 6, new_content: "x" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/out of range/);
  });
});

describe("deleteFileTool", () => {
  it("deletes a file and reports size", async () => {
    const path = join(TEST_DIR, "gone.txt");
    await writeFile(path, "12345", "utf-8");
    const result = await deleteFileTool.execute({ path });
    expect(result.success).toBe(true);
    expect(result.data).toContain("5 bytes");
    await expect(stat(path)).rejects.toBeTruthy();
  });

  it("refuses wildcard paths", async () => {
    const result = await deleteFileTool.execute({ path: join(TEST_DIR, "*.txt") });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Wildcards/);
  });

  it("refuses paths inside .git", async () => {
    const result = await deleteFileTool.execute({ path: join(TEST_DIR, ".git", "config") });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/\.git/);
  });

  it("refuses a non-empty directory", async () => {
    const dir = join(TEST_DIR, "full");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "f.txt"), "x", "utf-8");
    const result = await deleteFileTool.execute({ path: dir });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not empty/);
  });

  it("returns error for a missing file", async () => {
    const result = await deleteFileTool.execute({ path: join(TEST_DIR, "absent.txt") });
    expect(result.success).toBe(false);
  });
});

describe("downloadFileTool", () => {
  let server: Server;
  let port: number;

  beforeEach(async () => {
    server = createServer((req, res) => {
      if (req.url === "/file") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("downloaded-body");
      } else if (req.url === "/r1") {
        res.writeHead(302, { location: "/file" });
        res.end();
      } else if (req.url?.startsWith("/loop")) {
        // Endless redirect chain to trip the limit.
        const n = Number(req.url.slice("/loop".length) || "0");
        res.writeHead(302, { location: `/loop${n + 1}` });
        res.end();
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((r) => server.listen(0, r));
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("downloads a URL to a destination path", async () => {
    const dest = join(TEST_DIR, "dl.txt");
    const result = await downloadFileTool.execute({ url: `http://127.0.0.1:${port}/file`, destination: dest });
    expect(result.success).toBe(true);
    expect(await readFile(dest, "utf-8")).toBe("downloaded-body");
    expect(result.data).toContain("bytes");
  });

  it("follows a redirect", async () => {
    const dest = join(TEST_DIR, "dl2.txt");
    const result = await downloadFileTool.execute({ url: `http://127.0.0.1:${port}/r1`, destination: dest });
    expect(result.success).toBe(true);
    expect(await readFile(dest, "utf-8")).toBe("downloaded-body");
  });

  it("rejects non-HTTP schemes", async () => {
    const result = await downloadFileTool.execute({ url: "file:///etc/passwd", destination: join(TEST_DIR, "x") });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/http/i);
  });

  it("fails when the redirect limit is exceeded", async () => {
    const result = await downloadFileTool.execute({ url: `http://127.0.0.1:${port}/loop0`, destination: join(TEST_DIR, "y") });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/redirect/i);
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

import { homedir } from "node:os";
import { expandHome } from "../../src/tools/filesystem.js";

describe("tilde (~) home expansion", () => {
  it("expandHome resolves a leading ~ to the home directory", () => {
    expect(expandHome("~")).toBe(homedir());
    expect(expandHome("~/Desktop/x.txt")).toBe(join(homedir(), "Desktop/x.txt"));
    // No expansion when ~ isn't a leading path segment.
    expect(expandHome("/abs/path")).toBe("/abs/path");
    expect(expandHome("rel/path")).toBe("rel/path");
    expect(expandHome("~user/x")).toBe("~user/x");
  });

  it("write_file + read_file honour ~ (writes under home, not <cwd>/~)", async () => {
    const dir = ".iaa-tilde-test-" + Math.floor(Date.now()).toString(36);
    const tildePath = `~/${dir}/note.txt`;
    const realPath = join(homedir(), dir, "note.txt");
    try {
      const w = await writeFileTool.execute({ path: tildePath, content: "on desktop" });
      expect(w.success).toBe(true);
      // The file exists at the REAL home-relative path, not a literal "~" folder.
      expect((await stat(realPath)).isFile()).toBe(true);
      const r = await readFileTool.execute({ path: tildePath });
      expect(r.success).toBe(true);
      expect(r.data).toContain("on desktop");
    } finally {
      await rm(join(homedir(), dir), { recursive: true, force: true });
    }
  });
});
