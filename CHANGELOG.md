# Changelog

All notable changes to ItsAAgent are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

### Changed
- Added a tracked `pre-commit` hook (`.githooks/`) that blocks direct commits to `main`; enabled automatically via the `prepare` script.

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
