import type { Tool, ToolResult } from "../types.js";

const FETCH_MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 15_000;
const FETCH_MAX_BYTES = 8 * 1024;

/** Strip HTML to readable plain text (regex-based, no DOM). */
export function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

export const fetchTool: Tool = {
  definition: {
    name: "fetch",
    description: "Fetch an HTTP(S) URL (GET or POST). Returns status and body (HTML stripped to text, truncated to 8 KB).",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "HTTP(S) URL to fetch" },
        method: { type: "string", description: "GET (default) or POST" },
        headers: { type: "string", description: "Optional headers as a JSON object string" },
        body: { type: "string", description: "Optional request body (for POST)" },
      },
      required: ["url"],
    },
  },
  async execute(args): Promise<ToolResult> {
    const url = String(args.url ?? "");
    const method = String(args.method ?? "GET").toUpperCase();
    const body = args.body !== undefined ? String(args.body) : undefined;

    if (!/^https?:\/\//i.test(url)) {
      return { success: false, data: "", error: "Only http:// and https:// URLs are supported" };
    }

    let headers: Record<string, string> = {};
    if (args.headers) {
      try { headers = JSON.parse(String(args.headers)) as Record<string, string>; }
      catch { return { success: false, data: "", error: "headers must be a valid JSON object string" }; }
    }
    if (method === "POST" && body !== undefined && !Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) {
      headers["Content-Type"] = "application/json";
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      let current = url;
      let redirects = 0;
      let res: Response;
      while (true) {
        res = await fetch(current, {
          method,
          headers,
          body: method === "POST" ? body : undefined,
          redirect: "manual",
          signal: controller.signal,
        });
        if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
          redirects++;
          if (redirects > FETCH_MAX_REDIRECTS) {
            return { success: false, data: "", error: `Too many redirects (>${FETCH_MAX_REDIRECTS})` };
          }
          current = new URL(res.headers.get("location") as string, current).toString();
          continue;
        }
        break;
      }

      const contentType = res.headers.get("content-type") ?? "";
      let text = await res.text();
      if (/html/i.test(contentType)) text = stripHtml(text);
      if (text.length > FETCH_MAX_BYTES) text = text.slice(0, FETCH_MAX_BYTES) + "\n…[truncated]";

      return { success: true, data: `HTTP ${res.status}\n\n${text}` };
    } catch (err: unknown) {
      const msg = err instanceof Error && err.name === "AbortError"
        ? `Request timed out after ${FETCH_TIMEOUT_MS / 1000}s`
        : err instanceof Error ? err.message : String(err);
      return { success: false, data: "", error: msg };
    } finally {
      clearTimeout(timer);
    }
  },
};
