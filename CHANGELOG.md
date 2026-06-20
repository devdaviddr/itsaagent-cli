# Changelog

All notable changes to ItsAAgent are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

### Fixed
- Build agent reliability: added system-prompt rules so the model must emit a `<tool_call>` to perform any real action and must never claim success ("File created successfully") without a tool returning a result. Small local models (e.g. `qwen2.5-coder:7b`) were sometimes hallucinating completion instead of calling `write_file`/`bash`. The removed `cli` agent masked this because its smaller, focused tool set made the model commit to a shell call.

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
