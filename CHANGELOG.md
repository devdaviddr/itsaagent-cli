# Changelog

All notable changes to ItsAAgent are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

> Versioning was consolidated into three releases (0.1.0 / 0.2.0 / 0.3.0). The
> granular per-feature history remains in git.

---

## [0.4.0] — 2026-06-21 — Accuracy, reliability & semantic retrieval

Focused on making a small local model (qwen2.5-coder-7b / mistral) reliable at real coding and non-coding tasks: tighter feedback loops, smarter verification, and codebase grounding.

### Added
- **Semantic code search (`search_code` tool + `iaa index`)** — retrieve code by *meaning*, not just regex, so a small local model can work in a codebase that doesn't fit its context window. `iaa index [path]` walks the repo (reusing `repo_map`'s ignore-dir/extension sets), splits files into overlapping line-windows, embeds each via a local Ollama embedding model (`nomic-embed-text` by default, `/api/embed`), and persists vectors to `~/.config/ai-cli/index/<hash>.json`. The `search_code` tool embeds a natural-language query, ranks indexed chunks by cosine similarity, and returns the top matches as `path:start-end (score)` + snippet. Read-only — available to the `plan` agent and (via `tools: all`) the `build` agent. New `embedModel` config key (default `nomic-embed-text`). Live search requires `ollama pull nomic-embed-text` and an `iaa index` run first.
- **Inline diagnostics after every edit** — after a successful `write_file`/`edit_file`, the runtime runs the best *locally-available* checker for the file type (`tsc --noEmit` / `eslint` for TS-JS, `ruff` / `py_compile` for Python) and appends the result to the tool output, so the model sees real type/lint errors and self-corrects in the same loop. Never triggers an install, never blocks, tight timeout.
- **Task-type-aware verification** — the verification gate now detects whether a task is code or general and routes accordingly: code tasks get a system-generated deliverables checklist (every file written, dependency install, and detected test suite) and must confirm each with a real tool call; general tasks get a completeness self-critique pass.
- **Real token accounting** — captures Ollama's `prompt_eval_count`/`eval_count` and calibrates the token estimate (EMA), so context compaction fires on actual usage instead of a fixed chars-per-token guess.
- **Parallel tool execution** — when a tool-capable model emits multiple read-only tool calls in one turn, they run concurrently (mutations still run sequentially), cutting latency on exploration phases.
- **Compact prompt mode** — in native tool-calling mode the system prompt drops redundant parameter descriptions (the JSON schema already carries them), reclaiming ~300–500 tokens per call on a small window. On by default for the Ollama provider (`compactPrompt`).
- **Step-budget awareness** — the agent is nudged at 50/75/90% of its step budget to prioritise finishing over exploring.

### Fixed
- **Fuzzy/anchored `edit_file`** — when an exact `old_string` match fails (a local model rarely reproduces surrounding code verbatim), it now falls back to whitespace-normalized and then line-trim-anchored matching, replacing the correct original span and reporting which strategy matched and at what line. Eliminates the most common edit-retry loop on local models. Ambiguous matches still error rather than guess.
- **Looping** — exact-key loop abort plus a tightened recency nudge (fires at 3 repeats of a tool in the last 6 calls, was 5/8) and a more directive reprompt when the model narrates an action without taking it.
- **False-success / early-stop** — the "that reads like a status update" nudge now fires up to twice with an escalating message; the verify gate rejects a final answer that wasn't backed by a tool call (code tasks).
- **Context preservation** — old tool-result payloads are capped at 600 chars (was 200) and `FAILED` results are never truncated, so the error context the model needs survives compaction; tool-result display cap raised to 10k.
- **`node --check` no longer false-fails TypeScript** — parse-level syntax check is restricted to `.js`/`.mjs`/`.cjs`; `.ts`/`.tsx` go through `tsc` (or are skipped) instead of being wrongly flagged.
- **Correct working directory in the prompt** — the rules block and project/git context now use the live session cwd (`getSessionCwd()`) instead of the process launch dir, so paths are right after the agent `cd`s.
- **No duplicate system message** — `initSession()` atomically replaces the system prompt instead of appending a second one.
- **Plan agent can no longer mutate via git** — `git checkout`/`reset`/`clean`/`rebase`/`merge`/`push`/`pull`/`fetch`/`stash` are blocked for the read-only agent.
- **Robust git arg parsing** — backslash-escaped quotes inside commit messages are handled correctly.
- **Handoff seed** — the plan→build summary now carries the *most recent* commands run (was the first 10).
- **Streaming** — the NDJSON decoder is flushed at stream end so a split multi-byte character isn't dropped.

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
