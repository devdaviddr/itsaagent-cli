import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRepoMap, repoMapTool } from "../../src/tools/repoMap.js";
import { setSessionCwd, resetSessionCwd } from "../../src/tools/session.js";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  resetSessionCwd();
});

function sampleRepo(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "iaa-repomap-")));
  mkdirSync(join(d, "src"), { recursive: true });
  writeFileSync(join(d, "src", "a.ts"), "export function foo() {}\nexport class Bar {}\nconst x = 1;\n");
  writeFileSync(join(d, "src", "b.py"), "def baz():\n    pass\nclass Qux:\n    pass\n");
  mkdirSync(join(d, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(d, "node_modules", "pkg", "ignored.js"), "function shouldNotAppear() {}\n");
  return d;
}

describe("buildRepoMap", () => {
  it("extracts top-level symbols (ts + py) and groups by directory", () => {
    dir = sampleRepo();
    const { text, fileCount } = buildRepoMap(dir);
    expect(fileCount).toBe(2); // node_modules skipped
    expect(text).toContain("a.ts: foo, Bar");
    expect(text).toMatch(/b\.py:.*baz/);
    expect(text).toContain("Qux");
  });

  it("skips ignored directories like node_modules", () => {
    dir = sampleRepo();
    expect(buildRepoMap(dir).text).not.toContain("shouldNotAppear");
  });
});

describe("repo_map tool", () => {
  it("maps the session cwd", async () => {
    dir = sampleRepo();
    setSessionCwd(dir);
    const r = await repoMapTool.execute({});
    expect(r.success).toBe(true);
    expect(r.data).toContain("foo");
    expect(r.data).toContain("Repository map");
  });

  it("reports an empty result for a dir with no code files", async () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "iaa-empty-")));
    setSessionCwd(dir);
    const r = await repoMapTool.execute({});
    expect(r.success).toBe(true);
    expect(r.data).toMatch(/No code files/);
  });
});
