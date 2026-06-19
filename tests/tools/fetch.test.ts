import { createServer, type Server, type IncomingMessage } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchTool, stripHtml } from "../../src/tools/fetch.js";

describe("stripHtml", () => {
  it("removes tags, scripts, and styles", () => {
    const out = stripHtml("<style>x{}</style><h1>Hi</h1><script>bad()</script><p>there</p>");
    expect(out).not.toContain("<");
    expect(out).not.toContain("bad()");
    expect(out).toContain("Hi");
    expect(out).toContain("there");
  });
});

describe("fetchTool", () => {
  let server: Server;
  let port: number;
  let lastBody = "";
  let lastContentType = "";

  beforeEach(async () => {
    server = createServer((req: IncomingMessage, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c as Buffer));
      req.on("end", () => {
        if (req.url === "/text") {
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("plain body");
        } else if (req.url === "/html") {
          res.writeHead(200, { "content-type": "text/html" });
          res.end("<html><body><h1>Title</h1><p>Para</p></body></html>");
        } else if (req.url === "/echo") {
          lastBody = Buffer.concat(chunks).toString();
          lastContentType = req.headers["content-type"] ?? "";
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("ok");
        } else if (req.url?.startsWith("/loop")) {
          const n = Number(req.url.slice("/loop".length) || "0");
          res.writeHead(302, { location: `/loop${n + 1}` });
          res.end();
        } else {
          res.writeHead(404);
          res.end();
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("GET returns status and body", async () => {
    const result = await fetchTool.execute({ url: `http://127.0.0.1:${port}/text` });
    expect(result.success).toBe(true);
    expect(result.data).toContain("HTTP 200");
    expect(result.data).toContain("plain body");
  });

  it("POST sends a body with a JSON content-type by default", async () => {
    const result = await fetchTool.execute({ url: `http://127.0.0.1:${port}/echo`, method: "POST", body: '{"a":1}' });
    expect(result.success).toBe(true);
    expect(lastBody).toBe('{"a":1}');
    expect(lastContentType).toContain("application/json");
  });

  it("strips HTML responses to text", async () => {
    const result = await fetchTool.execute({ url: `http://127.0.0.1:${port}/html` });
    expect(result.success).toBe(true);
    expect(result.data).toContain("Title");
    expect(result.data).not.toContain("<h1>");
  });

  it("rejects non-HTTP schemes", async () => {
    const result = await fetchTool.execute({ url: "ftp://example.com/file" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/http/i);
  });

  it("fails when the redirect limit is exceeded", async () => {
    const result = await fetchTool.execute({ url: `http://127.0.0.1:${port}/loop0` });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/redirect/i);
  });
});
