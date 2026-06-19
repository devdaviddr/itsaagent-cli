# Tested models

How specific Ollama models behave with ItsAAgent. "Native tool use" is what
`iaa check` reports (whether the model advertises the `tools` capability).
Issues reference [KNOWN_ISSUES.md](./KNOWN_ISSUES.md).

Last updated: 2026-06-20 (v0.2.0).

| Model | Native tool use | Status | Notes / issues observed |
|---|---|---|---|
| `qwen2.5-coder-7b-32k:latest` | ✓ supported | ✅ Tested, works | Completes multi-step ReAct tasks correctly. Often emits tool calls as **text** rather than structured `tool_calls`, and sometimes uses the `"arguments"` key — handled by the fallback parser ([KI-1](./KNOWN_ISSUES.md#ki-1--models-emit-tool-calls-in-inconsistent-formats)). Final answers can be vague ([KI-2](./KNOWN_ISSUES.md#ki-2--7b-models-sometimes-produce-vague-final-answers)). |
| `mistral:7b` | — | ⚠️ Documented target, not yet re-verified in v0.2.0 | Worked in v0.1.0 with the XML text parser. Native tool-use support not confirmed; expected to run via the text-parser fallback. |

## Legend

- **✅ Tested, works** — verified end-to-end on a real task in this version.
- **⚠️ Not yet verified** — expected to work but not re-tested in this version.
- **❌ Broken** — known not to work; see notes.

## Adding a model

After running a few real tasks with a new model, add a row here with:
the exact `ollama` tag, whether `iaa check` reports native tool use, an
overall status, and any quirks you hit (link them to KNOWN_ISSUES.md).
