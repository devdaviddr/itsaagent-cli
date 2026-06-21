import { describe, expect, it } from "vitest";
import { locateEdit } from "../../src/tools/filesystem.js";

/** Helper: assert a successful locate and return the replaced span. */
function span(content: string, oldString: string): { slice: string; strategy: string } {
  const r = locateEdit(content, oldString);
  if ("error" in r) throw new Error(`expected match, got error: ${r.error}`);
  return { slice: content.slice(r.start, r.end), strategy: r.strategy };
}

describe("locateEdit — matching ladder", () => {
  it("exact: replaces a unique exact occurrence", () => {
    const content = "const a = 1;\nconst b = 2;\nconst c = 3;\n";
    const r = span(content, "const b = 2;");
    expect(r.strategy).toBe("exact");
    expect(r.slice).toBe("const b = 2;");
  });

  it("exact: errors when the string occurs more than once (not unique)", () => {
    const content = "x = 1\nx = 1\n";
    const r = locateEdit(content, "x = 1");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toMatch(/occurs 2 times|must be unique/i);
  });

  it("whitespace-normalized: matches when internal spacing differs", () => {
    // File uses single spaces; the model quotes it with extra spaces around '='.
    const content = "function f() {\n  return a + b;\n}\n";
    const r = span(content, "return   a   +   b;");
    expect(r.strategy).toMatch(/whitespace-normalized match at line \d+/);
    expect(r.slice).toBe("return a + b;");
  });

  it("whitespace-normalized: reports the correct 1-indexed line", () => {
    const content = "line one\nline two\n  target  here\nline four\n";
    const r = locateEdit(content, "target here");
    expect("error" in r).toBe(false);
    if (!("error" in r)) expect(r.strategy).toContain("line 3");
  });

  it("indentation difference is handled (whitespace-normalized matches first, as it should)", () => {
    // File indented with 4 spaces; model quotes with no indentation. The
    // whitespace-normalized stage (which trims per-line) already bridges this.
    const content = "class C {\n    foo() {\n        return 1;\n    }\n}\n";
    const r = span(content, "foo() {\nreturn 1;\n}");
    expect(r.strategy).toMatch(/whitespace-normalized|line-trim/);
    expect(r.slice).toContain("foo()");
    expect(r.slice).toContain("return 1;");
  });

  it("line-trim anchored: matches a block when only line-level trimming bridges the gap", () => {
    // Token-level whitespace normalization can't substring-match this because the
    // target's collapsed form isn't a contiguous slice of the file's collapsed form
    // (a trailing-comment line breaks the contiguous run); whole-line trimmed
    // comparison still lines the block up.
    const content =
      "function g() {\n\tlet total = 0;\t// running sum\n\treturn total;\n}\n";
    const r = span(content, "let total = 0; // running sum\nreturn total;");
    expect(r.strategy).toMatch(/whitespace-normalized|line-trim/);
    expect(r.slice).toContain("total");
  });

  it("not-found: returns a clear error with a hint about the first line", () => {
    const content = "alpha\nbeta\ngamma\n";
    const r = locateEdit(content, "this text\ndoes not exist anywhere");
    expect("error" in r).toBe(true);
    if ("error" in r) {
      expect(r.error).toMatch(/not found/i);
      expect(r.error).toMatch(/this text/);
    }
  });

  it("ambiguous (whitespace): two normalized matches → error, never a silent pick", () => {
    const content = "if (x) {\n  doThing();\n}\nif (y) {\n  doThing();\n}\n";
    const r = locateEdit(content, "doThing();");
    // Exact would already match twice → caught at the exact stage as not-unique.
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toMatch(/times|ambiguous/i);
  });

  it("ambiguous (line-trim): repeated indented blocks → error", () => {
    // Distinct exact text (different indentation per block) but identical when trimmed.
    const content = "a\n  block\n    end\nb\n      block\n        end\nc\n";
    const r = locateEdit(content, "block\nend");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toMatch(/ambiguous|runs/i);
  });

  it("offsets are exact so a round-trip replace is clean", () => {
    const content = "header\n    value = old\nfooter\n";
    const r = locateEdit(content, "value = old"); // indentation differs (none quoted)
    expect("error" in r).toBe(false);
    if (!("error" in r)) {
      const updated = content.slice(0, r.start) + "value = new" + content.slice(r.end);
      expect(updated).toBe("header\n    value = new\nfooter\n");
    }
  });
});
