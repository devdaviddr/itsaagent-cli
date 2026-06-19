# Changelog

All notable changes to ItsAAgent are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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

## [Unreleased]

_Nothing yet._
