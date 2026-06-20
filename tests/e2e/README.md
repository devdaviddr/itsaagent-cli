# End-to-end functional tests

These drive the **real** agent runtime against a **live Ollama model** and
assert on real effects — files created on disk, context remembered across
turns, a plan handed from the `plan` agent to the `build` agent. They are slow
and mildly non-deterministic (they depend on the model), so they live outside
the fast unit suite (`pnpm test`) and are run on demand.

> Unit tests (`pnpm test`, Vitest) verify pure logic with no model. This suite
> verifies the app actually works against a model. Run both.

## Prerequisites

- Ollama running locally (`iaa check` should be green).
- The configured model pulled (default `qwen2.5-coder-7b-32k:latest`). The
  optimised 32k model is the most reliable; weaker models may flake.

## Running

```bash
pnpm e2e                        # run every scenario on the configured model
pnpm e2e -- --list              # list scenarios without running
pnpm e2e -- --only handoff      # run scenarios whose name contains "handoff"
pnpm e2e -- --model mistral:7b  # override the model
pnpm e2e -- --retries 2         # retry a failing scenario up to N times
pnpm e2e -- --timeout 300       # per-scenario timeout in seconds (default 240)
pnpm e2e -- --keep              # keep the scratch dir for inspection
```

Exit code is non-zero if any scenario fails, so it is CI-friendly.

## Sandboxing

Each scenario gets its own clean directory under the OS temp dir
(`$TMPDIR/iaa-e2e/<scenario>`), and both the process cwd and the shared session
cwd are pointed at it. Nothing ever touches your real home directory.

## Scenarios

| Scenario | What it proves |
|---|---|
| `simple-chat` | Answers a conversational prompt with no tool call. |
| `shell-command` | Runs a shell command via the `bash` tool and reports the result. |
| `file-creation` | Creates a file with the requested content (`write_file`). |
| `folder-creation` | Creates a directory with a nested file. |
| `context-memory` | Uses an earlier tool result later in the **same** run. |
| `chat-memory` | Remembers facts **across chat turns** (`continueChat`). |
| `session-isolation` | A fresh session does **not** leak another session's context. |
| `plan-readonly` | The `plan` agent produces a plan and mutates **nothing**. |
| `handoff-express` | Plan an Express API, then hand the plan to `build`, which **actually builds it** (the headline test). |
| `ask-user` | An ambiguous request makes the agent call `ask_user`; the supplied answer drives the result. |

## Adding a scenario

Add a `scenario("name", "description", async (ctx) => { … })` block in
`e2e.ts`. Inside, use `ctx.runtime("build" | "plan")` to get a runtime with
event capture (`toolsUsed`, `asks`), and the assertion helpers
(`fileContains`, `dirExists`, `contains`, `notContains`, `listFiles`). Throw
(via `fail(...)` or an assertion helper) to fail the scenario. Keep assertions
lenient (case-insensitive `contains`, real disk effects) so normal model
variation doesn't cause false failures.
