import type { Tool, ToolResult } from "../types.js";
import { getSessionCwd } from "./session.js";
import { loadIndex, rankChunks } from "../agent/codeIndex.js";

/**
 * The embedder is a module-level singleton, mirroring the session-cwd pattern
 * (src/tools/session.ts) and the runtime's ask_user handler: the tool is stateless
 * and constructed without a provider handle, but it needs one to embed the query.
 * The runtime/CLI calls `setEmbedder(...)` after building the provider, so the tool
 * can reach a live embedding model without each call having to pass a provider in.
 */
let embedFn: ((texts: string[], model: string) => Promise<number[][]>) | undefined;
let embedModel = "nomic-embed-text";

/** Register (or clear) the embedding function + model used to embed search queries. */
export function setEmbedder(
  fn: ((texts: string[], model: string) => Promise<number[][]>) | undefined,
  model: string,
): void {
  embedFn = fn;
  if (model) embedModel = model;
}

/** Max characters of chunk text shown per result (keeps the tool result compact). */
const SNIPPET_CHARS = 400;

export const searchCodeTool: Tool = {
  definition: {
    name: "search_code",
    description:
      "Semantic code search — find the most relevant code chunks for a natural-language query using a local embedding index. Use this to locate where something is implemented before reading/editing. Requires an index built with `iaa index` first.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language description of the code you're looking for" },
        top_k: { type: "number", description: "How many results to return (default 5)" },
      },
      required: ["query"],
    },
  },
  async execute(args): Promise<ToolResult> {
    try {
      const query = String(args.query ?? "").trim();
      if (!query) return { success: false, data: "", error: "query is required." };
      const topK = Math.max(1, Math.floor(Number(args.top_k ?? 5)) || 5);

      const root = getSessionCwd();
      const index = await loadIndex(root);
      if (!index) {
        return {
          success: false,
          data: "",
          error: `No code index found for ${root}. Run \`iaa index\` in this directory first to build one.`,
        };
      }

      if (!embedFn) {
        return {
          success: false,
          data: "",
          error: "Embedding provider is unavailable — cannot embed the query. The provider may not support embeddings.",
        };
      }

      const vectors = await embedFn([query], embedModel);
      const queryVec = vectors[0];
      if (!Array.isArray(queryVec) || queryVec.length === 0) {
        return { success: false, data: "", error: "The embedding model returned no vector for the query." };
      }

      const ranked = rankChunks(queryVec, index.entries, topK);
      if (ranked.length === 0) {
        return { success: true, data: "No indexed code chunks to search. Re-run `iaa index`." };
      }

      const blocks = ranked.map((r) => {
        const header = `${r.path}:${r.startLine}-${r.endLine} (score ${r.score.toFixed(2)})`;
        const snippet = r.text.length > SNIPPET_CHARS ? r.text.slice(0, SNIPPET_CHARS) + "\n…[truncated]" : r.text;
        return `${header}\n${snippet}`;
      });
      return { success: true, data: blocks.join("\n\n---\n\n") };
    } catch (err: unknown) {
      return { success: false, data: "", error: err instanceof Error ? err.message : String(err) };
    }
  },
};
