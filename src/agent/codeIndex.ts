/**
 * Local semantic code index. Splits source files into overlapping line-windows,
 * embeds each window via a (caller-supplied) embedding function, and persists the
 * resulting vectors so `search_code` can retrieve relevant code by meaning rather
 * than by regex. Pure helpers (chunking, cosine similarity, ranking, path hashing)
 * are isolated so they can be unit-tested without a live model.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, relative, extname, resolve } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { IGNORE_DIRS, CODE_EXT } from "../tools/repoMap.js";

export interface CodeChunk {
  path: string;
  /** 1-indexed first line of the window (inclusive). */
  startLine: number;
  /** 1-indexed last line of the window (inclusive). */
  endLine: number;
  text: string;
}

export type IndexEntry = CodeChunk & { vector: number[] };

export type RankedResult = CodeChunk & { score: number };

export interface CodeIndex {
  root: string;
  model: string;
  createdAt: number;
  entries: IndexEntry[];
}

const DEFAULT_WINDOW_LINES = 40;
const DEFAULT_OVERLAP_LINES = 10;
/** Skip files larger than this — large generated/minified files pollute the index. */
const MAX_FILE_BYTES = 200 * 1024;
/** Hard cap on chunks to avoid runaway indexing of huge repos. */
const MAX_CHUNKS = 4000;
/** Embed this many chunks per /api/embed call. */
const EMBED_BATCH = 64;

/**
 * Split a file into overlapping line-windows. Pure. Lines are 1-indexed; empty or
 * whitespace-only windows are skipped. The stride is `windowLines - overlapLines`,
 * so consecutive windows share `overlapLines` lines of context at their boundary.
 */
export function chunkFile(
  path: string,
  content: string,
  opts?: { windowLines?: number; overlapLines?: number },
): CodeChunk[] {
  const windowLines = Math.max(1, opts?.windowLines ?? DEFAULT_WINDOW_LINES);
  const overlapLines = Math.max(0, Math.min(opts?.overlapLines ?? DEFAULT_OVERLAP_LINES, windowLines - 1));
  const stride = windowLines - overlapLines; // guaranteed >= 1
  const lines = content.split("\n");
  const chunks: CodeChunk[] = [];

  for (let start = 0; start < lines.length; start += stride) {
    const end = Math.min(start + windowLines, lines.length);
    const slice = lines.slice(start, end);
    const text = slice.join("\n");
    if (text.trim().length > 0) {
      chunks.push({ path, startLine: start + 1, endLine: end, text });
    }
    if (end >= lines.length) break;
  }
  return chunks;
}

/** Cosine similarity of two equal-length vectors. Returns 0 if either norm is 0. Pure. */
export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Rank index entries by cosine similarity to the query vector, return the top K. Pure. */
export function rankChunks(queryVec: number[], entries: IndexEntry[], topK: number): RankedResult[] {
  const scored = entries.map((e) => ({
    path: e.path,
    startLine: e.startLine,
    endLine: e.endLine,
    text: e.text,
    score: cosineSimilarity(queryVec, e.vector),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(0, topK));
}

/** Absolute path of the index file for a given root: ~/.config/ai-cli/index/<hash>.json. Pure. */
export function indexPathFor(rootDir: string): string {
  const abs = resolve(rootDir);
  const hash = createHash("sha1").update(abs).digest("hex").slice(0, 16);
  return join(homedir(), ".config", "ai-cli", "index", `${hash}.json`);
}

/** Persist an index as JSON, creating the index directory. Returns the file path. */
export async function saveIndex(index: CodeIndex): Promise<string> {
  const path = indexPathFor(index.root);
  await mkdir(join(homedir(), ".config", "ai-cli", "index"), { recursive: true });
  await writeFile(path, JSON.stringify(index), "utf-8");
  return path;
}

/** Load the index for a root, or null if it's missing or unparseable. */
export async function loadIndex(rootDir: string): Promise<CodeIndex | null> {
  try {
    const raw = await readFile(indexPathFor(rootDir), "utf-8");
    return JSON.parse(raw) as CodeIndex;
  } catch {
    return null;
  }
}

/**
 * Walk a directory for code files, reusing repoMap's ignore-dir and code-extension
 * sets so the index covers exactly the files repo_map surfaces. Returns absolute paths.
 */
function walkCodeFiles(root: string): string[] {
  const found: string[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name.startsWith(".") && name !== ".github") continue;
      const abs = join(dir, name);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!IGNORE_DIRS.has(name)) stack.push(abs);
        continue;
      }
      if (!CODE_EXT.has(extname(name)) || st.size > MAX_FILE_BYTES) continue;
      found.push(abs);
    }
  }
  found.sort();
  return found;
}

/**
 * Build a semantic index for a directory. Walks for code files, chunks them, and
 * embeds chunks in batches via the supplied embed function (one call per batch).
 * Caps total chunks at MAX_CHUNKS to avoid runaway indexing. `onProgress(done, total)`
 * fires after each embedded batch.
 */
export async function buildIndex(
  rootDir: string,
  embed: (texts: string[], model: string) => Promise<number[][]>,
  model: string,
  opts?: { onProgress?: (done: number, total: number) => void },
): Promise<CodeIndex> {
  const root = resolve(rootDir);
  const files = walkCodeFiles(root);

  // Collect chunks, capping the total to keep indexing bounded.
  const chunks: CodeChunk[] = [];
  for (const abs of files) {
    if (chunks.length >= MAX_CHUNKS) break;
    let content: string;
    try {
      content = readFileSync(abs, "utf-8");
    } catch {
      continue;
    }
    const rel = relative(root, abs);
    for (const c of chunkFile(rel, content)) {
      chunks.push(c);
      if (chunks.length >= MAX_CHUNKS) break;
    }
  }

  const total = chunks.length;
  const entries: IndexEntry[] = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const vectors = await embed(batch.map((c) => c.text), model);
    for (let j = 0; j < batch.length; j++) {
      const vector = vectors[j];
      if (Array.isArray(vector)) entries.push({ ...batch[j], vector });
    }
    opts?.onProgress?.(Math.min(i + batch.length, total), total);
  }

  return { root, model, createdAt: Date.now(), entries };
}
