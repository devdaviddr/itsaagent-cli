import { afterEach, describe, expect, it, vi } from "vitest";
import { OllamaProvider } from "../../src/providers/OllamaProvider.js";
import type { ProviderConfig } from "../../src/types.js";

function cfg(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return { type: "ollama", baseUrl: "http://localhost:11434", model: "test", temperature: 0.15, maxTokens: 8192, ...overrides };
}

/** A minimal NDJSON stream body with a single done chunk. */
function doneStream(): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(JSON.stringify({ message: { content: "" }, done: true }) + "\n"));
      controller.close();
    },
  });
}

async function drain(provider: OllamaProvider): Promise<void> {
  for await (const _ of provider.stream([{ role: "user", content: "hi" }])) {
    void _;
  }
}

describe("OllamaProvider request options", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends num_ctx when configured (Phase 0 fix)", async () => {
    let body: any;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      body = JSON.parse(String((init as RequestInit).body));
      return new Response(doneStream(), { status: 200 });
    });
    await drain(new OllamaProvider(cfg({ numCtx: 24576 })));
    expect(body.options.num_ctx).toBe(24576);
    expect(body.options.temperature).toBe(0.15);
    expect(body.options.num_predict).toBe(8192);
  });

  it("omits num_ctx when not configured", async () => {
    let body: any;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      body = JSON.parse(String((init as RequestInit).body));
      return new Response(doneStream(), { status: 200 });
    });
    await drain(new OllamaProvider(cfg()));
    expect(body.options.num_ctx).toBeUndefined();
  });
});
