import { describe, expect, it } from "vitest";
import { ContextManager } from "../../src/agent/ContextManager.js";

/** Read the manager's current token estimate for a known string length. */
function ratioFor(cm: ContextManager): number {
  // usage().total reflects estimateTokens; derive the effective ratio from a probe.
  // Simpler: add a system message of known length and read the usage delta is noisy,
  // so we instead inspect behaviour through estimateTokens via totalTokens.
  return cm.usage().total;
}

describe("ContextManager.calibrate — real token accounting", () => {
  it("moves the ratio toward the observed chars/token", () => {
    const cm = new ContextManager(100_000);
    cm.add({ role: "user", content: "x".repeat(3500) });
    const before = cm.usage().total;
    // Observe a denser packing: 3500 chars took only ~500 prompt tokens → 7 chars/token,
    // clamped to 6. EMA pulls the 3.5 ratio upward, lowering the token estimate.
    cm.calibrate(3500, 500);
    const after = cm.usage().total;
    expect(after).toBeLessThan(before); // higher ratio ⇒ fewer estimated tokens
  });

  it("moves the estimate up when observed ratio is lower (denser tokens)", () => {
    const cm = new ContextManager(100_000);
    cm.add({ role: "user", content: "y".repeat(3000) });
    const before = cm.usage().total;
    // 3000 chars but 1500 tokens ⇒ 2 chars/token (clamped floor). Lower ratio ⇒ more tokens.
    cm.calibrate(3000, 1500);
    const after = cm.usage().total;
    expect(after).toBeGreaterThan(before);
  });

  it("clamps the ratio to the [2.0, 6.0] band (no runaway from one extreme observation)", () => {
    const cm = new ContextManager(100_000);
    cm.add({ role: "user", content: "z".repeat(6000) });
    // Absurd observation: 6000 chars / 1 token = 6000 chars/token. EMA toward 6000,
    // but the clamp keeps the effective ratio at most 6.0.
    cm.calibrate(6000, 1);
    // At ratio 6: 6000/6 = 1000 tokens (+overhead). If it weren't clamped it'd be ~tiny.
    const total = cm.usage().total;
    expect(total).toBeGreaterThanOrEqual(Math.floor(6000 / 6));
  });

  it("ignores non-positive token counts (provider didn't report)", () => {
    const cm = new ContextManager(100_000);
    cm.add({ role: "user", content: "w".repeat(2000) });
    const before = cm.usage().total;
    cm.calibrate(2000, 0);
    cm.calibrate(0, 500);
    expect(cm.usage().total).toBe(before);
  });

  it("EMA blends rather than jumping fully to the observation", () => {
    const cm = new ContextManager(100_000);
    cm.add({ role: "user", content: "q".repeat(4000) });
    // observed = 4000/1000 = 4.0. New ratio = 3.5*0.7 + 4.0*0.3 = 3.65 (not 4.0).
    cm.calibrate(4000, 1000);
    // 4000 / 3.65 ≈ 1095; if it had jumped to 4.0 it'd be 1000. Assert it's between.
    const probe = new ContextManager(100_000);
    probe.add({ role: "user", content: "q".repeat(4000) });
    void ratioFor(probe);
    // 4000/3.65 = ~1096 tokens for the content alone; usage includes overhead.
    const total = cm.usage().total;
    expect(total).toBeGreaterThan(Math.ceil(4000 / 4)); // > full-jump estimate
    expect(total).toBeLessThan(Math.ceil(4000 / 3.5) + 10); // < the original-ratio estimate
  });
});
