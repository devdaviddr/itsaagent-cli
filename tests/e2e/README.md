# End-to-end functional tests

These drive the **real** agent runtime against a **live Ollama model** and
assert on real effects — files created/edited/deleted on disk, searches that
actually find things, context remembered across turns, and a plan handed from
the `plan` agent to the `build` agent (both at the runtime level and through
the TUI's capture path). They are slow and mildly non-deterministic (they
depend on the model), so they live outside the fast unit suite (`pnpm test`)
and are run on demand.

> Unit tests (`pnpm test`, Vitest) verify pure logic with no model — including
> the conversation reducer, the `plan → build` handoff wiring, and the
> **text-parser fallback** (a non-tool model's `<tool_call>` text → execute).
> This suite verifies the app actually works against a model. Run both.

## Prerequisites

- Ollama running locally (`iaa check` should be green).
- The configured model pulled (default `qwen2.5-coder-7b-32k:latest`). The
  optimised 32k model is the most reliable; weaker models flake more.

## Running

```bash
pnpm e2e                        # run every scenario once on the configured model
pnpm e2e -- --runs 3            # run each scenario 3× and report a pass-rate (reliability)
pnpm e2e -- --only handoff      # run scenarios whose name contains "handoff"
pnpm e2e -- --model mistral:7b  # override the model
pnpm e2e -- --list              # list scenarios without running
pnpm e2e -- --timeout 300       # per-run timeout in seconds (default 240)
pnpm e2e -- --keep              # keep the scratch dir for inspection
pnpm e2e -- --update-baseline   # write tests/e2e/baseline.json from this run
pnpm e2e -- --compare           # diff pass-rate + avg turns vs baseline (non-zero exit on regression)
```

### Trajectory scoring & regression baseline

Every run now records per-scenario **trajectory metrics** — reasoning turns,
tool calls, tool errors, repeated (wheel-spinning) calls, and clarifications —
so a short elegant solve and a long thrash no longer score identically. The
Markdown report shows `Turns` and `Tools` (with an `…e` error suffix) columns.

`tests/e2e/baseline.json` (committed) is the reference. `--update-baseline`
rewrites it from the current run; `--compare` diffs the current run against it
and **exits non-zero if any scenario's pass-rate dropped** (and warns when a
scenario gets materially slower at the same pass-rate). Use `--runs N` for a
stable baseline, e.g. `pnpm e2e -- --runs 5 --update-baseline`.

Exit code is non-zero if any scenario **fails**, so it is CI-friendly. A
`skip` or `flaky` does not fail the suite.

### Flaky vs failed (and the default retry)

Small local models are non-deterministic, so a single multi-step run flakes
occasionally. To keep that from producing false failures:

- At the default `--runs 1`, a scenario that fails is **retried once**. If the
  retry passes it is reported `flaky` (and the suite stays green); if it fails
  again it is a real `fail` (red). So a genuinely broken capability still fails;
  a one-off flake does not.
- At `--runs N` (N > 1) each scenario runs exactly N times with **no** retry,
  and the report shows the true pass-rate (e.g. `2/3`). Use this for a real
  reliability signal on a capability or a model.

## Results files

Every run writes a timestamped report to `tests/e2e/results/` (git-ignored):

- `e2e-<timestamp>.md` — human-readable: summary, a per-scenario table
  (status, pass-rate, avg time, failure note), and per-run detail.
- `e2e-<timestamp>.json` — the same data for tooling.

The paths are printed at the end of every run.

### Feature coverage

The Markdown report now groups scenarios by the **v0.4.0 capability** they
exercise, in a `## Feature coverage` section printed just under the summary
(and a `Feature` column in the per-scenario table). Each scenario carries a
`feature` tag — `edit-reliability`, `verification`, `semantic-search`,
`agent-safety`, or `core` — and the section prints a line per feature like
`- **semantic-search:** 1/1 passing`. `pass` and `flaky` both count as passing;
skipped scenarios are excluded from the denominator and surfaced as
`(N skipped)`. Features are listed alphabetically with `core` last, and the tag
is included per scenario in the JSON payload so tooling can group on it.

`search-code` is gated on the embed model and will show as skipped until you
pull it: `ollama pull nomic-embed-text`.

## Sandboxing

Each scenario (each run) gets its own clean directory under the OS temp dir
(`$TMPDIR/iaa-e2e/<scenario>`), and both the process cwd and the shared session
cwd are pointed at it. Nothing ever touches your real home directory.

## Scenarios

| Scenario | What it proves |
|---|---|
| `simple-chat` | Answers a conversational prompt with no tool call. |
| `shell-command` | Runs a shell command via the `bash` tool and reports the result. |
| `file-creation` | Creates a file with the requested content (`write_file`). |
| `folder-creation` | Creates a directory with a nested file. |
| `edit-file` | Reads then edits an existing file (line-based `edit_file`), preserving other lines. |
| `fuzzy-edit` | `edit_file` lands a change even when the model's `old_string` doesn't match the on-disk indentation verbatim (fuzzy/anchored matching). |
| `append-file` | Appends to a file without losing existing content. |
| `delete-file` | Deletes the named file and leaves others intact. |
| `glob-search` | Finds files by pattern (`glob`). |
| `grep-search` | Finds which file contains a string (`grep`). |
| `git-commit` | Stages and commits with the `git` tool; verified via `git log`. |
| `context-memory` | Uses an earlier tool result later in the **same** run. |
| `chat-memory` | Remembers facts **across chat turns** (`continueChat`). |
| `session-isolation` | A fresh session shares **no context** (structural + behavioural). |
| `plan-readonly` | The `plan` agent produces a plan and mutates **nothing**. |
| `handoff-express` | Plan an Express API, then hand off to `build`, which **actually builds it** (runtime path). |
| `guided-tui-handoff` | Plan → build through the **TUI's capture path** (conversation reducer + `lastAnswer`), exactly what pressing **Tab** does. |
| `ask-user` | An ambiguous request makes the agent call `ask_user`; the supplied answer drives the result. |
| `build-full-api` | The `build` agent codes a **complete** Express API (package.json + server + `/hello` route) in **one run** — no staggered stops. |
| `build-complete-script` | Same completeness on a **non-web** task (a Node CLI with edge-case handling) — proves the behaviour is general, not API-specific. |
| `general-completeness` | Answers **every part** of a multi-part non-code request (a numbered 3-part question) — completeness on the verification path beyond file/code tasks. |
| `make-folder` | Creates an **empty folder** as a real directory (`make_directory`) — not a 0-byte file. |
| `project-in-subfolder` | A project file lands **inside** the named subfolder (not the parent or home) — covers `make_directory` + the `bash cwd` fix. |
| `fetch-url` | Fetches a URL with the `fetch` tool (**gated** on outbound network). |
| `ssh-roundtrip` | Runs a command over SSH (**gated** on `IAA_E2E_SSH_HOST`, optionally `IAA_E2E_SSH_USER`). |
| `search-code` | Builds an embedding index (`iaa index`) and uses the `search_code` tool to find code **by meaning** (**gated** on the embed model). |

Gated scenarios **skip** (not fail) when their precondition is absent.

### Enabling the SSH scenario

```bash
IAA_E2E_SSH_HOST=my-server IAA_E2E_SSH_USER=me pnpm e2e -- --only ssh
```
It first checks the host is reachable with key-based auth; if not, it skips.

## What is NOT covered here (deliberately)

- **Live TUI rendering** — keypresses, focus, modal overlays, streaming
  redraw, and scrollback are properties of `tuir` in a real terminal and can't
  be asserted headlessly. The TUI **logic** (reducer, `/clear` reset, command
  parsing, the `plan → build` capture) is covered in the unit suite, and the
  handoff **flow** is exercised live by `guided-tui-handoff`. The remaining
  render/keypress behaviour is manual QA.
- **The OpenAI-compatible provider** — only the Ollama path is exercised here.

## Adding a scenario

Add a `scenario("name", "description", async (ctx) => { … })` block in
`e2e.ts`. Use `ctx.runtime("build" | "plan", modelOverride?)` for a runtime with
event capture (`toolsUsed`, `asks`), `ctx.agent(id)` for an agent definition,
and the assertion helpers (`fileContains`, `fileLacks`, `fileAbsent`,
`dirExists`, `contains`, `notContains`, `listFiles`). Call `skip("reason")` to
gate on a missing precondition. Throw (via `fail(...)` or an assertion helper)
to fail. Keep assertions lenient (case-insensitive `contains`, real disk
effects) so normal model variation doesn't cause false failures.
