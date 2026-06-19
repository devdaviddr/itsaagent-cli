# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project purpose

An AI-powered CLI tool that runs a local ReAct agent via Ollama. The agent can navigate the local filesystem, execute shell commands, and SSH into remote servers. No cloud dependency — everything runs on local hardware. Optimised for `qwen2.5-coder-7b-32k:latest` and `mistral:7b`.

## Commands

```bash
npm run build            # compile TypeScript → dist/
npm run typecheck        # type-check without emitting
npm run dev -- run "task"  # run without building (tsx watch)
npm install -g .         # install/update the global `ai` binary
```

After any source change: `npm run build && npm install -g .`

Manual test cycle:
```bash
iaa check                              # verify Ollama + model
iaa run "your task" -v                 # verbose: shows thought/tool/result each step
iaa run "your task" -l                 # silent run with session log written to disk
```

## Architecture

Six source files, no framework:

- **`src/index.ts`** — CLI entry point (commander). Loads `~/.config/ai-cli/config.json`, wires flags into `AgentConfig`, delegates to `AgentRuntime`.
- **`src/runtime.ts`** — Core ReAct loop. Calls `OllamaClient.chat()`, parses the response, executes the tool, appends both the assistant turn and tool result to context, loops until `<answer>` or max steps. Owns loop detection and `SessionLogger` integration.
- **`src/tools.ts`** — All tool implementations. Each tool is a self-contained object implementing `Tool`. SSH handles password/key auth, sudo retry on permission denied, and Wake-on-LAN auto-recovery.
- **`src/ollama.ts`** — Thin fetch wrapper for `/api/chat` and `/api/tags`. Stateless.
- **`src/context.ts`** — `ContextManager`: append-only message store with token estimation (3.5 chars/token) and oldest-first trimming. System prompt is never trimmed.
- **`src/logger.ts`** — `SessionLogger`: writes one markdown file per session to `~/.config/ai-cli/logs/` when `-v` or `-l` is passed.

## ReAct agent pattern

The loop in `runtime.ts` follows strict Thought → Action → Observation:

1. System prompt + conversation history sent to Ollama
2. Model response parsed for `<thought>`, `<tool_call>`, or `<answer>` blocks
3. **Assistant turn added to context first** (critical — model must see its own reasoning across steps)
4. If `<tool_call>`: execute tool, add `[TOOL RESULT]` as user message, repeat
5. If `<answer>` or no tool call: return final answer

**Loop detection**: same `tool:args` key repeated 3× aborts the run immediately.

**Planning**: the system prompt instructs the model to outline a plan in its first `<thought>` before acting. No separate planning phase — the thought block serves this role.

**Validation**: after mutations (write_file, ssh commands that change state), the model is expected to issue a follow-up verification command. The system prompt enforces this via the rules section.

## Tool call parsing (resilience)

Primary format (XML):
```
<thought>reasoning</thought>
<tool_call>
{"name": "bash", "args": {"command": "ls"}}
</tool_call>
```

Final answer format:
```
<thought>done</thought>
<answer>result text</answer>
```

`parseResponse()` tries three fallbacks in order:
1. `<tool_call>` XML block
2. Legacy `TOOL: name {args}` line (backward compat)
3. Bare JSON `{"name":"...","args":{...}}` — qwen2.5-coder frequently omits the wrapper tags

If none match, the full response is treated as a final answer.

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
- Tools must be stateless — no shared mutable state between executions

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
- **No streaming**: responses are collected in full before parsing — keeps parser logic simple
- The Ollama API at `/api/chat` uses `{"stream": false}` — do not change to streaming without updating the parser

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
3. Build + test must pass before merging: `npm run build && npm test`
4. Merge to `main` (squash if the branch has noisy WIP commits)
5. Tag releases on `main`: `git tag v0.2.0 && git push --tags`

### Release versioning

Follows [semver](https://semver.org):
- **patch** `0.1.x` — bug fixes, no new tools or commands
- **minor** `0.x.0` — new tools, commands, or provider support (backward-compatible)
- **major** `x.0.0` — breaking config changes or CLI interface changes

Update `package.json` version and add a `CHANGELOG.md` entry for every release.
