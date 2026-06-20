/**
 * Per-model sampling/decoding defaults. Different local models follow the ReAct
 * contract best with different settings; one global default underperforms most.
 * Profiles are matched by model-name pattern (first match wins) and provide the
 * DEFAULTS — anything set explicitly in config (temperature/numPredict/stop)
 * overrides them. Add a profile here (or override in config) to tune a model.
 */
export interface ModelProfile {
  /** Sampling temperature. Structured tool output wants this low. */
  temperature: number;
  /** Max tokens to generate per turn. 7B models produce long reasoning chains. */
  numPredict: number;
  /** Optional extra stop sequences. */
  stop?: string[];
}

const DEFAULT_PROFILE: ModelProfile = { temperature: 0.15, numPredict: 8192 };

const PROFILES: Array<{ match: RegExp; profile: ModelProfile }> = [
  // Qwen coder family — the optimised target; low temp, long generations.
  { match: /qwen.*coder|qwen3-?coder/i, profile: { temperature: 0.15, numPredict: 8192 } },
  // Mistral — same shape works well.
  { match: /mistral/i, profile: { temperature: 0.15, numPredict: 8192 } },
  // Gemma family (incl. local fine-tunes like gemma4-coder).
  { match: /gemma/i, profile: { temperature: 0.15, numPredict: 8192 } },
  // DeepSeek coder.
  { match: /deepseek/i, profile: { temperature: 0.2, numPredict: 8192 } },
];

/** Resolve the default profile for a model name (falls back to a safe default). */
export function resolveModelProfile(model: string): ModelProfile {
  return PROFILES.find((p) => p.match.test(model))?.profile ?? DEFAULT_PROFILE;
}
