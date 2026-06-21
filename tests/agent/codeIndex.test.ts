import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  chunkFile,
  cosineSimilarity,
  rankChunks,
  indexPathFor,
  buildIndex,
  type IndexEntry,
} from "../../src/agent/codeIndex.js";

describe("chunkFile", () => {
  it("splits a file into overlapping windows with 1-indexed line numbers", () => {
    // 50 lines, window 20, overlap 5 -> stride 15.
    const content = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n");
    const chunks = chunkFile("a.ts", content, { windowLines: 20, overlapLines: 5 });

    expect(chunks[0].startLine).toBe(1);
    expect(chunks[0].endLine).toBe(20);
    // stride = 15 -> next window starts at line 16.
    expect(chunks[1].startLine).toBe(16);
    expect(chunks[1].endLine).toBe(35);
    // overlap: last 5 lines of chunk 0 are the first 5 lines of chunk 1.
    expect(chunks[0].text.split("\n").slice(-5)).toEqual(chunks[1].text.split("\n").slice(0, 5));
    // every chunk carries the path.
    for (const c of chunks) expect(c.path).toBe("a.ts");
  });

  it("covers every line: the last window ends on the final line", () => {
    const content = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n");
    const chunks = chunkFile("a.ts", content, { windowLines: 20, overlapLines: 5 });
    expect(chunks[chunks.length - 1].endLine).toBe(50);
  });

  it("skips empty / whitespace-only windows", () => {
    const content = ["   ", "", "\t", "  "].join("\n");
    expect(chunkFile("blank.ts", content, { windowLines: 2, overlapLines: 0 })).toEqual([]);
  });

  it("produces a single chunk for a small file", () => {
    const chunks = chunkFile("small.ts", "const x = 1;\nconst y = 2;", { windowLines: 40, overlapLines: 10 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ startLine: 1, endLine: 2 });
  });

  it("clamps overlap below the window size so stride stays positive", () => {
    const content = Array.from({ length: 10 }, (_, i) => `l${i}`).join("\n");
    // overlap >= window would yield stride 0; chunkFile must clamp it.
    const chunks = chunkFile("a.ts", content, { windowLines: 4, overlapLines: 10 });
    expect(chunks.length).toBeGreaterThan(0);
    // no infinite loop, and chunks advance.
    expect(chunks[chunks.length - 1].endLine).toBe(10);
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it("returns 0 when either vector has zero norm", () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
    expect(cosineSimilarity([1, 2], [0, 0])).toBe(0);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1, 10);
  });
});

describe("rankChunks", () => {
  const mk = (path: string, vector: number[]): IndexEntry => ({
    path,
    startLine: 1,
    endLine: 2,
    text: path,
    vector,
  });

  it("orders entries by descending similarity and respects topK", () => {
    const entries = [
      mk("far", [0, 1]),
      mk("near", [1, 0.1]),
      mk("mid", [1, 0.5]),
    ];
    const ranked = rankChunks([1, 0], entries, 2);
    expect(ranked).toHaveLength(2);
    expect(ranked[0].path).toBe("near");
    expect(ranked[1].path).toBe("mid");
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
  });

  it("returns all entries when topK exceeds the count", () => {
    const entries = [mk("a", [1, 0]), mk("b", [0, 1])];
    expect(rankChunks([1, 0], entries, 10)).toHaveLength(2);
  });

  it("returns an empty list for topK <= 0", () => {
    const entries = [mk("a", [1, 0])];
    expect(rankChunks([1, 0], entries, 0)).toEqual([]);
  });
});

describe("indexPathFor", () => {
  it("is deterministic and lives under ~/.config/ai-cli/index", () => {
    const p1 = indexPathFor("/tmp/project");
    const p2 = indexPathFor("/tmp/project");
    expect(p1).toBe(p2);
    expect(p1.startsWith(join(homedir(), ".config", "ai-cli", "index"))).toBe(true);
    expect(p1.endsWith(".json")).toBe(true);
  });

  it("produces different paths for different roots", () => {
    expect(indexPathFor("/tmp/a")).not.toBe(indexPathFor("/tmp/b"));
  });

  it("resolves relative roots to the same hash as their absolute form", () => {
    // resolve("") === process.cwd(); both should hash identically.
    expect(indexPathFor(process.cwd())).toBe(indexPathFor("."));
  });
});

describe("buildIndex (with a fake embedder)", () => {
  it("embeds chunks in batches and pairs each chunk with its vector", async () => {
    // Deterministic fake embedder: vector encodes the call so we can assert pairing.
    let calls = 0;
    const fakeEmbed = async (texts: string[]): Promise<number[][]> => {
      calls++;
      return texts.map((t) => [t.length, 1]);
    };
    const index = await buildIndex(process.cwd() + "/src/agent", fakeEmbed, "fake-model");
    expect(calls).toBeGreaterThan(0);
    expect(index.model).toBe("fake-model");
    expect(index.entries.length).toBeGreaterThan(0);
    for (const e of index.entries) {
      expect(e.vector).toEqual([e.text.length, 1]);
    }
  });
});
