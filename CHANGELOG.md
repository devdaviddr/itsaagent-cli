# Changelog

All notable changes to ItsAAgent are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

> Versioning was consolidated into three releases (0.1.0 / 0.2.0 / 0.3.0). The
> granular per-feature history remains in git.

---

## [0.3.0] — 2026-06-21 — Codebase & context awareness

### Added
- **Auto-loaded project context (`AGENTS.md`)** — working in a code folder, the agent loads the **nearest** `AGENTS.md` (walking up from the session dir) into the prompt and reloads it as it `cd`s between projects, so conventions and build/test commands ground the model without you repeating them. `projectContext: false` to disable.
- **Git awareness** — opening `iaa` in a repo injects a pinned `## Git` block (branch, changed files, recent commits) into the prompt (refreshed each turn), so the agent knows the repo state without running `git status`; the TUI status line shows `⎇ <branch> · <n> changed`. `gitContext: false` to disable.
- **`repo_map` tool** — a structural codebase index: every code file grouped by directory with its top-level functions/classes/exports (language-aware, capped, optional subdir). The agent calls it to orient before answering codebase questions or navigating. Read-only (the `plan` agent can use it too).
- **Context compaction** — as the window fills (default ≥80%) the context is compressed instead of only evicted at 100%. `compaction: "structured"` (default, no LLM): cap old tool-result payloads and stub a `read_file` that was later re-read/edited. `compaction: "summarize"` also folds older turns into one pinned `[CONVERSATION SUMMARY]` via a local-model call. `compaction: "off"` restores pure eviction. `compactionThreshold` (default 0.8).

### Fixed
- **Guided plan→build produces complete, runnable projects.** The `plan` agent now writes **agent-executable** plans (concrete tool steps, no "open Finder/paste/Postman" human instructions); the handoff tells `build` to carry out *every* step and start acting immediately; the **verification gate enforces completeness** (every file + dependency install + command, not just "does what I made exist"); and the prompt now tells the agent to **quote paths** in shell commands.
- **`bash`'s `cwd` is one-off and no longer compounds** — it used to persist as the session dir, so repeating a relative `cwd` (e.g. `todo-api`) nested deeper each call (`todo-api/todo-api/…`). Use `cd` to move persistently.

## [0.2.0] — 2026-06-21 — Reliable dynamic harness + sessions

### Added
- **Sessions, persistence & resume** — chats run inside a first-class `Session`; they autosave to `~/.config/ai-cli/sessions/` each turn. `iaa sessions` lists them; `iaa chat --resume [id]` restores context, tool history, agent, model, and cwd. `/save [path]` exports a full Markdown transcript.
- **Self-verification + completion** — a `run_tests` tool (auto-detects npm/pnpm/pytest/cargo/make); a **verification gate** that makes `build` confirm its work with a tool before finishing; and a best-effort recovery turn instead of dead-end aborts. The `build` agent plans first and builds the whole solution; the `plan` agent gathers info (and `ask_user`) until it can plan.
- **Headless advised processes** — `iaa run --process guided "<task>"` runs the plan → build pipeline end-to-end (`ProcessRunner`).
- **Local-model tuning** — request the full context window (`num_ctx`, with output headroom); branch the prompt on native vs text tool-calling; a worked few-shot exemplar; per-model sampling profiles (`temperature`/`numPredict`/`stop`, overridable in config); bounded provider retries for cold-start hiccups.
- **Smarter context** — per-message token overhead in the estimate; oldest-first eviction now folds the deterministic "work so far" digest into the notice so it survives trimming.
- **Live end-to-end test suite** (`pnpm e2e`) — drives the real runtime against a live model and asserts on real effects, with reliability runs (`--runs N`), trajectory scoring, and a regression baseline (`--compare`).

### Fixed
- **`make_directory` tool** — "create a folder" makes a real directory, not a 0-byte file; `write_file` clearly errors when a parent is a file.
- **`edit_file` is string-based (`old_string`/`new_string`)** — ends the line-number miscounts that silently corrupted code.
- **Files no longer written as one line with literal `\n`** (double-escaped newlines are repaired).
- **`bash`/`git`/file tools share the session working directory** — `cd` carries over and `git` targets the right repo.
- **Tool results lead with `— OK`/`— FAILED`**, and status-shaped answers are re-prompted once, to curb hallucinated success.
- **No duplicate system prompt on the first chat turn.**

## [0.1.0] — 2026-06-20 — Foundation

Initial ItsAAgent: a local-first, Ollama-optimised ReAct agent for the CLI.

### Added
- **ReAct loop** (Thought → Action → Observation) with native function-calling for capable models and a text-format parser fallback; loop detection and per-tool failure escalation.
- **Built-in agents** `build` (full access) and `plan` (read-only), plus `ask_user` clarification, a guided plan→build process, and a context handoff summary.
- **Built-in tools** — `bash`, `ssh`/`ssh_upload`/`ssh_download` (with Wake-on-LAN), `git`, `fetch`, `read_file`, `write_file`, `edit_file`, `append_file`, `delete_file`, `download_file`, `glob`, `grep`.
- **Persistent TUI** (built on `tuir`) — scrollable log, streaming, markdown answers, floating picker/info modals, inline `/`-autocomplete, themes; plus a scriptable one-shot `iaa run`.
- **User-defined agents & skills** (markdown), provider abstraction (Ollama or OpenAI-compatible), a 24k-token context manager with eviction, session logging, and the `iaa` config/commands surface.

> Consolidates the earlier 0.1.0–0.6.0 development (foundation, file-tool fixes, TUI overhaul, cancellation, and the sessions/ask_user/guided-process work). Full detail is in git history.
