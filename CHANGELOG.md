# Changelog

All notable changes to ItsAAgent are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

> Work toward a more dynamic local-model harness (spec/v0.7.0.md), from a 7-dimension multi-agent review.

### Changed (Phase 4: per-model prompt)
- **The system prompt now adapts to the model's tool-calling mode.** When the model supports native function-calling, the prompt drops the text `<tool_call>` XML schema and tells it to call tools directly — previously it taught the XML format even in native mode, a contradictory "emit native *and* XML" instruction that made small models waste turns. Final answers still use `<answer>` in both modes. The prompt is rebuilt once native capability is detected (history preserved).

### Added (Phase 3: enforce completion / self-correction)
- **`run_tests` tool** — runs the project's test suite (auto-detects `npm`/`pnpm`/`yarn test`, `pytest`, `cargo test`, or `make test`) in the session cwd and reports a normalized PASS/FAIL. The verification primitive the agent uses to check its own work.
- **Verification gate** — before accepting the *first* `<answer>` on a build run that actually mutated something, the loop injects one `[VERIFY]` turn making the model confirm the deliverables exist/work with a tool. Fires at most once per run; read-only/plan answers and non-mutating runs pass straight through.
- **Best-effort recovery** — three consecutive failures of a tool no longer dead-end with an error string; the loop injects one `[RECOVERY]` turn (switch approach / `ask_user` / summarize what was done). Still hard-aborts if failures continue after the single recovery turn.

### Added (Phase 2: make dynamism measurable)
- **Trajectory scoring in the e2e harness** — each run records reasoning turns, tool calls, tool errors, repeated (wheel-spinning) calls, and clarifications, surfaced as `Turns`/`Tools` columns so a short solve and a long thrash no longer score identically.
- **Regression baseline** — `tests/e2e/baseline.json` plus `--update-baseline` and `--compare`; the suite exits non-zero if any scenario's pass-rate drops vs the baseline (and warns when a scenario gets materially slower).

### Added (Phase 0–1: correctness + deterministic reliability wins)
- **Few-shot exemplar in the system prompt** — one worked Thought→tool_call→[TOOL RESULT]→answer trajectory that also models "answer only after the result confirms success". On by default; toggle with `"fewShot": false` in config to A/B it.

### Fixed (Phase 0–1)
- **Context window is now actually requested from Ollama (`num_ctx`).** `maxContextTokens` was trimmed client-side but never sent to the server, so Ollama silently ran at its small default window and truncated the very context the harness preserved — a root cause of forgetting/premature-stopping on multi-step tasks. It is now threaded into `ProviderConfig` and sent as `options.num_ctx`.
- **`git` now uses the session working directory.** It ran in `process.cwd()`, so after the model `cd`'d via `bash`, `git status/add/commit` silently targeted the wrong repo. It now honours the shared session cwd like the other tools.
- **Tool results lead with an explicit `— OK`/`— FAILED` token** (and a "do not claim success" line on failure). Small models missed the old conditional trailing `Error:` and hallucinated success.
- **Status-shaped answers are re-prompted once** instead of accepted. When a build run emits an `<answer>` that reads like a progress update ("Next I'll edit…"), the loop nudges it to finish the task (capped to once per run; plan answers unaffected).

### Added
- **`make_directory` tool** — creates a folder (and any missing parents). Fixes a class of failures where, asked to "create a folder", the agent misused `write_file` and produced a **0-byte file** with the folder's name (so later writes into it failed with a confusing `EEXIST mkdir`). The prompt and tool descriptions now steer folder creation to `make_directory`, and `write_file` documents that it makes parent folders itself.

### Fixed
- **`edit_file` is now string-based (find/replace), fixing silent code corruption.** It was line-number based, so to change a value the model had to count lines — and miscounts replaced the wrong line (e.g. asked to change `'Hello World!'` to `'Hello Emma!'`, it overwrote the `app.get(...)` route opener and left a duplicate `res.send`, breaking the server). `edit_file` now prefers `old_string`/`new_string`: it replaces the exact text, requires it to occur exactly once (else it refuses with guidance and changes nothing), and treats `$` literally. Line mode (`start_line`/`end_line`) remains for pure inserts/range-deletes. The model reliably picks string mode now (modify-a-running-file: 3/3).
- **`bash` now honours a `cwd` argument.** Previously a command like `npm init -y` with `cwd` set was run in the session's directory regardless, so it could write `package.json` into the **home directory**. `bash` now runs in the requested `cwd` (validated to exist) and persists it like `cd`; the prompt tells the agent to `cd`/pass `cwd` when working inside a project folder.
- **`write_file` gives a clear error** when a parent path component is a file instead of a directory (it used to surface a raw `EEXIST: mkdir …`), pointing at `make_directory`.

### Changed
- **Agents now plan-first and build the whole solution.** Both built-in agents got a general (stack-agnostic) operating contract in their system-prompt suffix, fixing the "staggered" behaviour where the `build` agent would do one step (e.g. `npm install`) or create an empty file with `touch` and then stop, handing a half-finished result back. **Build** now: (1) plans the approach first when it wasn't handed a plan, (2) calls `ask_user` for anything unknown/ambiguous instead of guessing, (3) carries out every step and writes complete, runnable, best-practice code (full file contents via `write_file`, never stubs), and (4) only answers once the task actually works. **Plan** keeps gathering information (read/search/`ask_user`) until it can plan correctly, then emits a plan complete enough to build the whole thing. Verified general (not API-specific): a full Express API and an unrelated Node CLI script each build to completion 3/3.

### Added
- **End-to-end test suite** (`pnpm e2e`, `tests/e2e/`) — drives the real agent runtime against a live Ollama model and asserts on real effects. 19 scenarios: simple chat, shell commands, file/folder creation, **edit/append/delete**, **glob/grep search**, **git commit**, within-run context memory, across-turn chat memory, a strengthened **session-isolation** check (structural + behavioural), the read-only `plan` agent, the **plan → build handoff building an Express API** (runtime path), the **same handoff through the TUI's capture path** (conversation reducer + `lastAnswer`, i.e. pressing Tab), `ask_user` clarification, plus **gated** `fetch` (network) and `ssh` (`IAA_E2E_SSH_HOST`) scenarios that skip cleanly when unavailable.
  - **Reliability mode** `--runs N` runs each scenario N times and reports a pass-rate; at the default `--runs 1` a failing scenario is retried once so a one-off model flake reports as `flaky` rather than failing the suite (a genuinely broken capability still fails twice → red).
  - **Result reports** are written to `tests/e2e/results/` as timestamped Markdown (human review) and JSON (tooling) on every run.
  - Flags: `--only`, `--model`, `--runs`, `--timeout`, `--keep`, `--list`. Each scenario runs in a sandboxed temp dir. Complements the fast Vitest unit suite (`pnpm test`).
- **Unit coverage for the TUI handoff + parser fallback** — `lastAnswer()` (the plan-capture used on Tab) is extracted from `App.tsx` into `state/conversation.ts` and unit-tested alongside `/clear` reset semantics and the capture→handoff wiring; a new test exercises the **text-parser fallback** end-to-end (a non-tool model's `<tool_call>` text is parsed and executed).

---

## [0.6.0] — 2026-06-20

### Added
- **Sessions** — a chat now runs inside a first-class `Session` that owns its context, active agent, model, working directory, and tool history. Agent hand-offs happen *within* a session, so context and exploration carry across the plan → build boundary instead of being thrown away.
- **`ask_user` tool** — a clarification primitive. When a request is ambiguous or needs information only you have (a name, a choice, a value), the agent asks one specific question and waits for your answer instead of guessing. In non-interactive `iaa run`, it proceeds with stated assumptions.
- **Guided process** (`/guided <task>`) — plan a task, let the plan agent clarify ambiguities via `ask_user`, then press **Tab** to hand the approach off to `build` for execution. A status line tracks the stage (`Guided · plan ✓ — Tab → build`).

### Changed
- **Compact hand-off summary** — handing a plan to `build` now seeds it with the plan *plus* a deduped "already explored" summary (files read, searches run, commands run, files written during planning), so build doesn't re-discover what plan already learned.
- **Slim system prompt** — consolidated from 15 numbered rules to 7 sharp, high-impact ones with no loss of the critical rules (one-tool-per-response + `"name"`/`"args"` format, anti-hallucination, real-home-dir/cwd-persists, OS-appropriate non-interactive commands, `ask_user`-on-ambiguity, no-repeat/stop-on-failure). Re-measured: `qwen2.5-coder-7b-32k:latest` create-file 3/3 + express-api PASS; `qwen2.5-coder:7b` create-file 3/3 (up from 2/3).
- Mouse/trackpad wheel scroll in the TUI is now **opt-in** (`mouse: true` in `~/.config/ai-cli/config.json`). It was capturing mouse events, which disabled native terminal text-selection/copy. Keyboard scroll (↑/↓, Ctrl+U/D) works regardless; with `mouse: true`, hold Option (macOS) to select.

### Fixed
- **Working directory now persists across tool calls.** Each `bash` command ran in a fresh shell, so a `cd` was lost and later commands ran in the launch directory — e.g. "build an express api" did `cd express-hello-world` then `npm init`/`npm install`/`write_file`, which all dumped into the user's **home directory**, leaving the project folder empty. A shared session cwd now carries `cd` to subsequent `bash` calls and to the file tools (`write_file`, `read_file`, `glob`, `grep`, …), like a real terminal.
- Build agent reliability — "File created successfully" with no file actually created. Three root causes:
  - **Parser priority:** small models often emit a tool call *and* an `<answer>` in one response (the answer fabricated before the tool ran). The parser checked `<answer>` first and threw the tool call away. Tool calls are now parsed **before** `<answer>`, so the tool runs and the model answers next turn.
  - **Prompt:** added rules that any real action MUST be a `<tool_call>` and that the model must never claim success without an actual `[TOOL RESULT]`; create files via `write_file(path, content)`.
  - **Paths:** the system prompt now states the real home directory (and that `~` is expanded), so the model stops inventing placeholder paths like `/Users/your_username/Desktop`.
  - Result: `qwen2.5-coder:7b` went from 0/3 → 2/3 on a multi-turn "create a file" test; the optimised `qwen2.5-coder-7b-32k:latest` is 3/3.
- TUI tool-call rendering: the collapsed result line could garble (e.g. `(+2 morennect to host…`) and the status icon could be clipped. Tool lines now push cleanly and the message box trims overflow; the icon is always visible.

---

## [0.5.1] — 2026-06-20

### Added
- **Plan → build handoff** — in the TUI, when the `plan` agent has produced an approach, press **Tab** to hand it off to `build`: it switches agent, seeds build with the plan, and runs it. A `Tab → hand off to build` hint shows when available. `plan` stays read-only until you hand off.

### Changed
- **Two built-in agents** — `build` and `plan`. `plan`'s prompt now asks for a concrete, executable approach.

### Removed
- The **`cli` agent**. `build` (`tools: "all"`) already had every tool `cli` did (`bash`, `ssh`, `ssh_upload`, `ssh_download`, `fetch`, `download_file`), so nothing is lost. `--agent cli` / `/agent cli` now errors `Unknown agent`.

### Fixed
- File tools (`read_file`, `write_file`, `edit_file`, `append_file`, `delete_file`, `download_file`) now expand a leading `~` to the home directory. Previously `~/Desktop/x` was written to `<cwd>/~/Desktop/x` (a literal `~` folder), so the `build` agent appeared to "fail" to write to the Desktop while the `cli` agent (using `bash`, which the shell expands) worked. Both now behave the same.

---

## [0.5.0] — 2026-06-20

Persistent-TUI UX overhaul. See `spec/v0.5.0.md`. Backward-compatible (minor): CLI commands, flags, and config keys are unchanged; the legacy one-shot `iaa run` view is untouched.

### Added
- **True overlay modals** — the persistent TUI's view layer migrated from Ink to the `tuir` fork (Ink can't do z-index overlays). `/agent`, `/model`, `/theme`, and `/tools` open as centered floating dialogs over the conversation, with search, ↑/↓ navigation, and Esc to close.
- **Line-level scrollback** — scroll the whole conversation line-by-line: ↑/↓ (one line), Ctrl+U/Ctrl+D (half-page), Esc (jump to latest), and **mouse/trackpad wheel**. A long answer no longer overflows the input.
- **Token streaming** — `OllamaProvider` now always streams; responses render token-by-token even with tools attached (tool calls still execute).
- **Markdown styling** — answers render fenced code blocks, headings, and prose in distinct theme colours; the transcript sits in its own panel-coloured area.
- **Theming** — optional `background`/`panel` fills and a `bold` weight toggle; new built-in themes `dracula`, `nord`, `gruvbox`; a user-defined `custom` theme via the `customTheme` config object.
- **Browsable `/tools`** — a selectable tool list → pick one → detail view with full parameters. `/help` and `/about` are read-only info modals.

### Changed
- Borderless input and command palette; the chat area keeps a panel background (no border).
- The persistent TUI no longer uses tuir's `<Viewport>` (it forced full-height rendering and flicker); a plain root box one row short keeps tuir on its incremental-diff path.
- `iaa run "task"` (no `-i`) and the non-TTY/piped renderer remain on Ink and are unchanged.

### Fixed
- Fullscreen flicker (full-height clear-every-frame path) and a "Maximum update depth" render loop in the modal sync.
- Input going unresponsive after a modal closes or after `/clear` (and other idle-staying commands) — the input now reliably re-enters insert mode.

### Removed
- Dead legacy TUI renderers superseded by the line-based log: `EntryView`, `ToolBlock`, `layout/viewport.ts`, `layout/Header.tsx`. The Ink modal integration tests (incompatible with tuir, which has no headless harness) in favour of pure-logic tests.

---

## [0.4.0] — 2026-06-20

Persistent, opencode-style TUI. See `spec/v0.4.0.md`. Backward-compatible (minor): no existing flag, output, or config key changes meaning.

### Added
- **Persistent TUI** (F-01/F-06) — a single full-screen Ink app (header · scrollable message log · fixed input box · status line) replaces the no-arg home menu and backs `iaa chat`. Keyboard scrollback (PgUp/PgDn; Esc returns to latest when idle), terminal-width-aware windowing, a live context bar, and a provider-unreachable warning. Built on a pure conversation-state reducer (`src/cli/tui/state/conversation.ts`) with a bounded streaming buffer.
- **`iaa run -i`** — opens the persistent TUI seeded with the task. `iaa run "task"` without `-i` keeps the legacy one-shot render; non-TTY/piped runs use the unchanged plain renderer.
- **Collapsible tool blocks** (F-03) — collapsed summary with a "N more lines — Enter to expand" marker (no more silent 120-char cut); Ctrl+R expands/collapses all; ↑/↓ + Enter focus/toggle a block when the input is empty.
- **Inline slash commands + autocomplete** (F-05) — a `/`-triggered popup (Tab to complete). New `/theme`, `/models`, `/tools` alongside `/agent`, `/agents`, `/model`, `/clear`, `/help`, `/exit`; results post as in-log entries.
- **Theming** (F-04) — central semantic palette with built-in `default` and `mono` themes, selectable via the optional `theme` config key and `/theme` (persists, re-themes live).
- **In-TUI cancellation** (F-07) — `AgentRuntime.cancel()` stops an in-flight run cooperatively, emitting a new `cancelled` event. `Esc` cancels a running turn and keeps the session open; `Ctrl+C` quits at idle and cancels-then-quits during a run.
- A tracked `pre-commit` hook (`.githooks/`) that blocks direct commits to `main` (enabled via the `prepare` script), and a project Claude skill (`.claude/skills/new-feature-skill/`) enforcing the Spec-Driven Development workflow.

### Changed
- The no-arg `iaa` and `iaa chat` now launch the persistent TUI instead of the Clack menu / plain REPL. The non-interactive subcommands (`run` without `-i`, `config`, `check`, `tools`, …) are unchanged.

### Fixed
- The TUI event hook no longer calls `removeAllListeners()` (which wiped every subscriber); listeners are detached individually (D-1).
- Streaming no longer keeps an unbounded per-run buffer; only the active step buffers deltas (D-4).
- Context-usage thresholds (60/80) are defined once and shared (D-6).
- A stuck run can be cancelled from the TUI instead of killing the whole process (D-7).
- New dependency: `ink-text-input`.

---

## [0.3.0] — 2026-06-20

### Added
- (M-01) `iaa tools [name]` command — lists built-in tools with required params; `iaa tools <name>` shows full parameter detail and which built-in agents permit it. Home menu gains a "Tools" browser.
- (M-02) Home menu agent selection — `Agent: <id>` item opens a picker (built-ins first, custom tagged); Run/Chat use the chosen agent.
- (M-05) Home menu status header — shows `agent · model · provider · host`, with a ⚡ marker when the active model supports native tool use; updates after changes.
- (M-06) Home menu model picker — `Model: <name>` item lists live provider models and persists the choice.
- (M-04) Consistent back navigation — every sub-menu has a "← Back" item; Esc goes back in sub-menus and quits at the home menu.
- (M-03) In-chat slash commands — `/agent <name>` (switch agent, resets context), `/agents`, `/model <name>` (switch + persist), `/help`, plus existing `/clear` and `/exit`. The chat prompt shows the active agent. `AgentRuntime` gained `setAgent()` / `setModel()`.

### Fixed
- Conversational input (greetings, small talk, questions answerable from knowledge) is now answered directly instead of triggering tool use — fixes `iaa chat` running `bash` for "hello". Added a prompt rule against interactive commands (`read`, editors) that have no stdin.
- Text tool-call parser now accepts the OpenAI-style `arguments` key in addition to `args`.

---

## [0.2.0] — 2026-06-20

### Breaking
- (CLI-01) CLI binary renamed from `ai` to `iaa`. Run `npm install -g .` to update. All subcommands (`iaa run`, `iaa chat`, `iaa check`, etc.) follow the new name.

### Fixed
- (C-01) `iaa chat` now maintains conversation context across turns — the model can recall previous messages within a session

### Added
- (A-01) Agent registry with `build` (full-access), `plan` (read-only), and `cli` (shell/infra) built-in agents; `--agent` flag on `iaa run` and `iaa chat`; `iaa agents` command
- (A-02) User-defined agents — markdown files in `~/.config/ai-cli/agents/` with YAML frontmatter; supports `tools`, `readonly`, `model` overrides; composable with `--agent`
- (X-02) Skill system — markdown files in `~/.config/ai-cli/skills/` with `{{placeholder}}` interpolation; `--skill` flag and `/name` shorthand; `iaa skills` command; multiple skills composable
- (R-01) `read_file` line range support (`start_line`, `end_line` — 1-indexed, inclusive) and 150 KB size guard with guidance message
- (R-02) Context eviction notification — model receives an in-context notice when messages are trimmed
- (U-01) Context usage indicator — live bar and token counts in TUI header; threshold-based stderr output in plain/chat mode
- (R-03) `ssh_upload` and `ssh_download` tools for SCP-based file transfer to/from remote hosts
- (R-04) Recency-window loop detection (same tool 5+ times in last 8 calls) and per-tool failure escalation with hard abort after 3 consecutive failures
- (R-05) System prompt rules 9 and 10: file size awareness before reading, and structured failure recovery strategy
- (T-01) `delete_file` tool — safe single-file/empty-dir deletion; refuses wildcards and `.git/` paths
- (T-02) `download_file` tool — streams a URL to a local file path with no size limit; 120s timeout
- (T-03) `append_file` tool — appends content to a file without overwriting; creates file if missing
- (F-01) `edit_file` tool — line-range replacement (`start_line`, `end_line`, `new_content`) with unified diff output
- (F-02) `fetch` tool — HTTP/HTTPS GET and POST with redirect following (max 5), HTML stripping, 8 KB truncation, 15s timeout
- (F-03) `git` tool — `status`, `diff`, `log`, `add`, `commit`, `branch`, `checkout`, `show`, `stash`; destructive subcommands blocked
- (F-09) Native Ollama function calling for models with `tools` capability; falls back to the text parser when a response has no structured tool_calls (so text-format tool calls are still honoured)
- (CLI-02) Interactive home menu when `iaa` is run with no arguments — agent/skill/settings navigation via arrow keys using Clack; falls back to help text in non-TTY

---

## [0.1.0] — 2026-06-19

First public release.

### Added

**Core agent**
- ReAct loop (Thought → Action → Observation) powered by Ollama
- Three-fallback response parser: `<tool_call>` XML → legacy `TOOL:` format → bare JSON
- Bare JSON fallback correctly scoped to text after `</thought>` to avoid false positives
- Loop detection: same tool + args called 3× aborts with a clear message (key-order independent via sorted JSON)
- Thought-only reprompt: model is nudged to act rather than silently terminate
- Max-steps guard with `MaxStepsError`
- Context management with token estimation (3.5 chars/token), oldest-first eviction, system prompt and original task always pinned

**Provider abstraction**
- `Provider` interface (`stream`, `checkHealth`, `listModels`)
- `OllamaProvider` — NDJSON streaming, health check via `/api/tags`
- `OpenAICompatProvider` — SSE streaming, API key from env (`AI_API_KEY` / `OPENAI_API_KEY`)
- `createProvider()` factory; provider type selectable in config

**Tools**
- `bash` — shell command execution via `execFile` (no shell injection), 30 s timeout
- `read_file` — UTF-8 file read
- `write_file` — atomic write with parent directory creation
- `glob` — pattern-based file search
- `grep` — recursive content search with optional glob filter
- `ssh` — remote command execution with ControlMaster persistence, Wake-on-LAN auto-recovery, password sourced from `SSH_PASS` env only (never CLI args), socket directory restricted to 0700

**CLI**
- `ai run "<task>"` — single task run
- `ai chat` — interactive multi-turn session
- `ai check` — provider + model health check (`:latest` suffix normalised)
- `ai models` — list available models
- `ai config` — view/edit config with guided prompts
- Global flags: `--model`, `--host`, `--max-steps`, `-v` (verbose), `-l` (log to file)

**TUI**
- Live Ink-based terminal UI: spinner, per-step status (thinking / executing / done / error), streaming token display
- TTY detection — falls back to plain text output automatically (safe for pipes and scripts)
- Clack menus for provider selection, model picker, and interactive input

**Session logging**
- One markdown file per session written to `~/.config/ai-cli/logs/` when `-v` or `-l` is passed
- Logs include task, model, each step's thought + tool call + result, final answer, and errors

**System prompt**
- OS platform, version, and architecture injected at runtime so the model uses correct commands (macOS vs Linux)
- Numbered rules optimised for qwen2.5-coder and mistral 7B: XML structure, one tool call per turn, no repeated calls

**Tests**
- 40 unit tests across parser, context manager, bash tool, filesystem tools, and agent runtime
- Covers loop detection, `isExplicitAnswer`, false-positive guard, bare-JSON-after-thought, context trim preservation, and MaxStepsError

### Fixed
- `OllamaProvider.checkHealth()` previously accepted 404 responses as healthy; now checks `res.ok`
- `ContextManager.trim()` previously evicted the original user task; now pins both system prompt and task (index 0 and 1)
- SSH child processes previously inherited `SSH_PASS` from the environment; now stripped via `safeEnv()`
- Socket directory created world-accessible; now chmod 0700
- `AgentView` listener cleanup used `removeAllListeners()`; replaced with per-event `runtime.off()` to avoid removing external listeners
- `renderWithInk` rejected on agent error causing unhandled rejection crash; now resolves (error already shown in TUI)
- Model name `:latest` suffix mismatch in `ai check` and `ai run` model availability test

---
