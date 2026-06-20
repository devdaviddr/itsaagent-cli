# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project purpose

An AI-powered CLI tool that runs a local ReAct agent via Ollama. The agent can navigate the local filesystem, execute shell commands, and SSH into remote servers. No cloud dependency — everything runs on local hardware. Optimised for `qwen2.5-coder-7b-32k:latest` and `mistral:7b`.

## Commands

This project uses **pnpm** (pinned via `packageManager` in package.json). Do not use npm or yarn.

```bash
pnpm install             # install dependencies
pnpm build               # compile TypeScript → dist/
pnpm typecheck           # type-check without emitting
pnpm dev -- run "task"   # run without building (tsx watch)
pnpm test                # run the Vitest unit suite (pure logic, no model)
pnpm e2e                 # run the live end-to-end suite (real model; see tests/e2e/)
pnpm add -g .            # install/update the global `iaa` binary
```

`pnpm test` is fast and deterministic (no model). `pnpm e2e` drives the real
runtime against a live Ollama model and asserts on real effects (files created,
context remembered, plan→build handoff). It is slow and model-dependent — run
it before a release. See `tests/e2e/README.md`.

After any source change: `pnpm build && pnpm add -g .`

Manual test cycle:
```bash
iaa check                              # verify Ollama + model
iaa run "your task" -v                 # verbose: shows thought/tool/result each step
iaa run "your task" -l                 # silent run with session log written to disk
```

## Architecture

Organised by layer under `src/`, no framework:

- **`src/index.ts`** — CLI entry point (commander). Loads config, registers commands, defines global flags. With no args in a TTY it launches the home menu (`src/cli/menu.ts`); otherwise it parses the command line.
- **`src/agent/`** — the agent core:
  - `Session.ts` — the first-class context owner: a session holds the `ContextManager`, active `AgentDefinition`, model, cwd, tool history, and agent transitions. `setAgent()` records a transition; `recordTool()` logs every call; `examinedSummary()` produces the deduped "already explored" digest used in hand-offs.
  - `AgentRuntime.ts` — the ReAct loop (`run`, `continueChat`, private `runLoop`) over a `Session` (private `ctx`/`agent` getters delegate to it). Sends tools natively when the model supports them, reads `message.tool_calls`, falls back to `parseResponse()` otherwise. Owns loop detection, failure escalation, and `SessionLogger` integration. `executeTool()` intercepts `ask_user` (routes to `askUserHandler`, emits `ask`) and records tool history. `handoffToBuild(buildAgent, planText)` switches agent and resets context with the plan + `examinedSummary()` seed. `cancel()` cooperatively stops an in-flight loop (checked at the step boundary and around the provider stream), emitting the `cancelled` event and resolving with a `[cancelled]` sentinel.
  - `AgentDefinition.ts` / `AgentRegistry.ts` / `AgentLoader.ts` — built-in agents (`build` full-access, `plan` read-only), the registry, and the markdown loader for user agents. In the TUI, `plan` can hand its approach off to `build` via Tab (seeds build with the plan + planning summary).
  - `Process.ts` — data-driven advised processes. Ships one built-in, `GUIDED_PROCESS` (plan → build); `nextStageIndex`/`stageAgent` are the pure stage state machine driving `/guided`. `ProcessRunner.ts` (`runProcess`) drives a process end-to-end headless (`iaa run --process guided`): first stage via `run()`, each later stage via `handoffToBuild()`.
  - `SkillLoader.ts` / `frontmatter.ts` — markdown skill loading, `{{arg}}` interpolation, shared frontmatter parsing.
  - `ContextManager.ts` — append-only message store, token estimation (3.5 chars/token), oldest-first trim with an in-context eviction notice, `onEvict`/`onUsage` callbacks.
  - `promptBuilder.ts` — builds the system prompt (rules, permitted-tool descriptions, agent suffix, active skills).
  - `parser.ts` — the text-format fallback parser. `SessionLogger.ts` — per-session markdown logs. `errors.ts` — typed agent errors.
- **`src/providers/`** — `Provider` interface, `OllamaProvider` (NDJSON stream + native `tools` + `supportsTools()` via `/api/show`; sends `num_ctx`/`stop`; bounded retries on 5xx/connection failure), `OpenAICompatProvider`, `modelProfiles.ts` (per-model sampling defaults, overridable via config), factory.
- **`src/tools/`** — one file per tool family (`ask` (`ask_user`), `bash` (accepts an optional `cwd`), `ssh` incl. upload/download, `git` (session-cwd aware), `fetch`, `verify` (`run_tests` — auto-detects npm/pytest/cargo/make), `filesystem` incl. read/write/make_directory/edit (string find-replace or line range)/append/delete/download). `index.ts` exposes `getDefaultTools()`; `session.ts` holds the shared session cwd. `ask_user` is a runtime-intercepted primitive — its `execute()` is only the non-interactive fallback.
- **`src/cli/`** — `commands/` (run, chat, agents, skills, models, check, config), `output.ts` (render routing: interactive TUI / one-shot Ink / plain — see `selectRenderMode`), `config.ts` (config + `toAgentConfig`), `contextBar.ts` (+ shared `CTX_*` thresholds), `chatCommands.ts` (slash-command parser + `matchCommands` autocomplete), `skillResolve.ts`. `menu.ts` remains for `shouldShowMenu` but the no-arg `iaa` now launches the persistent TUI.
  - **`src/cli/tui/`** — the persistent TUI (v0.5.0), built on **`tuir`** (an Ink fork with real z-index `Modal` overlays + focus-trapping). `launch.ts` (`launchTui`/`launchHomeTui`; `preserveScreen` + `setMouseReporting`) renders `App.tsx`, which owns one `AgentRuntime` across turns (continueChat semantics) and two `useTextInput` fields (prompt + modal search). Deliberately **no `<Viewport>`** — a plain root box sized `rows-1` keeps output under the terminal height (avoids tuir's clear-every-frame flicker). `state/conversation.ts` is the pure event→entry reducer (bounded streaming buffer, line scroll offset, `reset`). `layout/flatten.ts` flattens entries to styled wrapped lines + `windowLines` (line-level scroll + `markdownLines`); `layout/` also has MessageLog (panel-coloured, borderless), InputBox, StatusLine, `chrome.ts`. `components/` has SelectModal (select + info variants), CommandPalette, SpinnerT, pure `select.ts`/`toolFormat.ts`. `theme.ts` (semantic palette, built-in + custom themes, backgrounds/bold), `about.ts`, `hooks/useAgentEvents.ts` (per-handler `off()`). `AgentView.tsx`/`StepView.tsx`/`Spinner.tsx` stay on **Ink** for the legacy one-shot `iaa run` view (separate render path).

## ReAct agent pattern

`AgentRuntime.runLoop()` follows strict Thought → Action → Observation:

1. System prompt + conversation history sent to the provider, with `tools` attached when the model is tool-capable.
2. Response read as `message.tool_calls` (native) or, if absent, via `parseResponse()` on the text.
3. **Assistant turn added to context first** (critical — model must see its own reasoning across steps).
4. If a tool call: check it's permitted by the active agent, execute it, add `[TOOL RESULT]` as a user message, repeat.
5. If a final answer or no tool call: return it.

`run()` starts a fresh context; `continueChat()` preserves it across turns (used by `iaa chat`). `initSession()` sets the system prompt once.

**Loop / failure recovery**: exact `tool:args` repeated 3× aborts; the same tool name 5+ times in the last 8 calls injects a nudge; 2 consecutive failures of one tool warns, 3 aborts (counter resets on that tool's success).

**Agent scoping**: the active `AgentDefinition` filters which tools are callable and which appear in the system prompt. A blocked call returns `"Tool not permitted by active agent"`.

## Tool calling

Capable models (detected via `OllamaProvider.supportsTools()`) receive `tools` in the request and reply with structured `message.tool_calls`. When a response has no structured tool calls — including a tool-capable model that emitted a call as text — the loop falls back to `parseResponse()`, which tries, in order:

1. `<tool_call>` XML block (primary text format)
2. Legacy `TOOL: name {args}` line (backward compat)
3. Bare JSON `{"name":"...","args":{...}}` after `</thought>`

If none match, the full response is treated as a final answer. Final answers use `<answer>…</answer>`.

## Adding a new tool

Implement the `Tool` interface in `src/tools.ts` and add it to `getDefaultTools()`. That's all — the tool description is automatically included in the system prompt via `buildToolDescriptions()`.

```typescript
const myTool: Tool = {
  definition: {
    name: "my_tool",
    description: "One clear sentence describing what this tool does and when to use it.",
    parameters: {
      type: "object",
      properties: {
        param: { type: "string", description: "What this parameter controls" },
      },
      required: ["param"],
    },
  },
  async execute(args): Promise<ToolResult> {
    const param = String(args.param ?? "");
    try {
      // implementation
      return { success: true, data: "output" };
    } catch (err: any) {
      return { success: false, data: "", error: err.message };
    }
  },
};
```

Rules for tools:
- Always return `ToolResult` — never throw out of `execute()`
- `data` is what the model reads; `error` is stderr/diagnostic info
- `exitCode` should reflect the actual process exit code when wrapping shell commands
- Coerce all args with `String(args.x ?? "")` / `Number(args.x ?? default)` — model may pass wrong types
- Set realistic timeouts on all shell/network calls; default bash timeout is 30s
- Tools must be stateless — no shared mutable state between executions. **Exception:** the session working directory (`src/tools/session.ts`). A terminal is inherently stateful, so `bash` persists `cd` across calls and the file tools resolve relative paths against it (`resolveSessionPath`). Tests reset it via `resetSessionCwd()`.

## TypeScript conventions

- Strict mode is on — no `any` except in `catch (err: any)` blocks
- Use `unknown` for untyped external data, narrow before use
- All async functions return explicit `Promise<T>`
- Prefer `const` tool objects over classes for tools (simpler, tree-shakeable)
- Exported surface: only what `index.ts` needs (`AgentRuntime`) and what `tools.ts` needs (`Tool`, `ToolResult`, `ToolDefinition`)

## Ollama integration

- **Temperature**: 0.15 — structured output requires low temperature; creative tasks can go to 0.3 max
- **num_predict**: 8192 — 7b models produce longer reasoning chains; don't lower this
- **Context window**: capped at 24576 tokens (leaves ~8k headroom for output in a 32k model)
- **Model checking**: `checkOllama()` validates both connectivity and model availability before any run
- **Streaming**: `/api/chat` is called with `{"stream": true}`. Content deltas are yielded as `chunk` events (rendered token-by-token in the TUI) and `tool_calls` are accumulated across the streamed chunks, then emitted on the final `done` chunk. The text-format parser only runs when no native `tool_calls` are present.

## Ollama model targeting

When writing or modifying system prompts:
- Both `qwen2.5-coder` and `mistral` respond well to XML-tagged structure (`<thought>`, `<tool_call>`, `<answer>`)
- Use imperative, numbered rules — bullet prose is ignored more often than numbered rules
- One tool call per response is a hard rule that must appear in the system prompt; these models will chain calls if not told otherwise
- JSON inside `<tool_call>` must use `"name"` and `"args"` keys exactly — document this in the prompt
- Keep the system prompt under ~1500 tokens; larger prompts crowd out tool results in the context window

## Config

`~/.config/ai-cli/config.json` — managed via `iaa config` subcommand.

```json
{
  "model": "qwen2.5-coder-7b-32k:latest",
  "host": "http://localhost:11434",
  "maxSteps": 25,
  "maxContextTokens": 24576,
  "logDir": "~/.config/ai-cli/logs"
}
```

`logDir` is used by `SessionLogger` when `-v` or `-l` is passed. Set via `iaa config --set-log-dir <path>`.

## Git branching strategy

This project uses **GitHub Flow** — simple, trunk-based, always-releasable `main`.

**Direct commits to `main` are blocked** by a tracked `pre-commit` hook (`.githooks/pre-commit`, enabled via `core.hooksPath`, wired by the `prepare` script). All changes — features, fixes, and releases (version bump + changelog) — go on a branch and merge. Bypass only if you truly must: `git commit --no-verify`.

### Branch naming

| Prefix | Purpose | Example |
|---|---|---|
| `feat/` | New feature | `feat/ssh-key-auth` |
| `fix/` | Bug fix | `fix/loop-detection-parser` |
| `chore/` | Deps, config, tooling | `chore/update-ink` |
| `docs/` | Docs only | `docs/readme-quickstart` |

### Flow

1. Branch from `main`: `git checkout -b feat/my-thing`
2. Make changes; keep commits small and descriptive
3. Build + test must pass before merging: `pnpm build && pnpm test`
4. Merge to `main` (squash if the branch has noisy WIP commits)
5. Tag releases on `main`: `git tag v0.2.0 && git push --tags`

### Release versioning

Follows [semver](https://semver.org):
- **patch** `0.1.x` — bug fixes, no new tools or commands
- **minor** `0.x.0` — new tools, commands, or provider support (backward-compatible)
- **major** `x.0.0` — breaking config changes or CLI interface changes

Update `package.json` version and add a `CHANGELOG.md` entry for every release.
