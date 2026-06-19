# ItsAAgent

> A local-first ReAct agent for the terminal. No cloud. No API keys. Runs on your machine.

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![Ollama](https://img.shields.io/badge/powered%20by-Ollama-orange)
![Status](https://img.shields.io/badge/status-alpha-yellow)

**ItsAAgent** is an AI-powered CLI tool that runs a [ReAct](https://arxiv.org/abs/2210.03629) (Reason + Act) agent loop entirely on local hardware via [Ollama](https://ollama.com). It can navigate your filesystem, run shell commands, and SSH into remote servers — all driven by a locally-hosted LLM.

Built for developers who want an autonomous agent without a cloud subscription.

🌐 [itsaagent.ai](https://itsaagent.ai)

---

## Features

- **ReAct loop** — Thought → Action → Observation, repeated until done or the step limit is reached
- **Native tool calling** — uses Ollama's function-calling API for capable models, with a text parser as automatic fallback
- **Built-in agents** — `build` (full access), `plan` (read-only), `cli` (shell/infra); each scopes which tools the model may call
- **User-defined agents & skills** — drop a markdown file in `~/.config/ai-cli/agents/` or `skills/` to add a persona or a reusable workflow
- **13 built-in tools** — `bash`, `ssh`, `ssh_upload`, `ssh_download`, `git`, `fetch`, `read_file`, `write_file`, `edit_file`, `append_file`, `delete_file`, `download_file`, `glob`, `grep`
- **SSH + Wake-on-LAN** — runs commands and transfers files over SSH; auto-wakes sleeping machines before retrying
- **Interactive home menu** — run `iaa` with no arguments for a guided menu (run a task, chat, browse agents/skills, settings)
- **Live TUI** — Ink-powered terminal UI with streaming output, step-by-step progress, and a context-usage bar
- **Provider abstraction** — Ollama (default) or any OpenAI-compatible endpoint
- **Context management** — 24 576-token window, oldest-first eviction with an in-context trim notice
- **Session logging** — structured markdown log per run (`-v` or `-l`)
- **Resilience** — exact-match and recency-window loop detection, per-tool failure escalation, large-file read guards

---

## Requirements

- [Node.js](https://nodejs.org) 18+
- [pnpm](https://pnpm.io) 9+ (`corepack enable pnpm`, or `npm i -g pnpm` once)
- [Ollama](https://ollama.com) running locally

---

## Quick start

```bash
# Pull the recommended model
ollama pull qwen2.5-coder:7b

# Clone and install
git clone https://github.com/devdaviddr/itsaagent-cli.git
cd itsaagent-cli
pnpm install
pnpm build
pnpm add -g .          # install the global `iaa` binary

# Verify everything is connected (also reports native tool-use support)
iaa check

# Run a task
iaa run "list typescript files in this project and count lines of code" -v

# …or just launch the interactive menu
iaa
```

---

## CLI reference

```
iaa                  Interactive home menu (no arguments, in a terminal)
iaa run <task...>    Execute a one-shot task (prefix /skill-name to run a skill)
iaa chat             Interactive multi-turn session (keeps context; /clear, /exit)
iaa agents           List available agents and their tool access
iaa skills           List installed skills
iaa models           List available Ollama models
iaa check            Verify Ollama, model availability, and native tool-use support
iaa config           View or update persistent config
```

### Flags

| Flag | Description |
|---|---|
| `-v, --verbose` | Stream thoughts, tool calls, and results live. Also writes a session log. |
| `-l, --log` | Write session log only (no console output beyond the final answer) |
| `-m, --model <name>` | Override model for this run |
| `-a, --agent <id>` | Select an agent: `build` (default), `plan`, `cli`, or a custom one |
| `--skill <name>` | Apply a skill (repeatable) |
| `--skill-arg <name=value>` | Provide a value for a skill placeholder (repeatable) |
| `-s, --max-steps <n>` | Override max ReAct iterations (default: 25) |
| `--host <url>` | Ollama server URL (default: `http://localhost:11434`) |

### Persistent config

```bash
iaa config --set-model qwen2.5-coder:7b
iaa config --set-max-steps 40
iaa config --set-log-dir ~/my-agent-logs
```

Config stored at `~/.config/ai-cli/config.json`.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          CLI  (src/cli/)                        │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ run.ts   │  │ chat.ts  │  │ check.ts │  │ config.ts     │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───────────────┘  │
│       │              │              │                            │
│       └──────────────┴──────────────┘                           │
│                       │                                         │
│              ┌─────────▼──────────┐                             │
│              │    output.ts       │  TTY?                        │
│              │  ┌──────────────┐  │──────► Ink TUI (AgentView)  │
│              │  │ renderPlain  │  │──────► plain stderr          │
│              └─────────┬────────┘                               │
└────────────────────────┼────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│                   AgentRuntime  (src/agent/)                    │
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                    ReAct Loop                           │   │
│   │                                                         │   │
│   │   ┌──────────┐    ┌──────────┐    ┌────────────────┐   │   │
│   │   │  THINK   │───►│   ACT    │───►│   OBSERVE      │   │   │
│   │   │ <thought>│    │<tool_call│    │ [TOOL RESULT]  │   │   │
│   │   └──────────┘    └────┬─────┘    └───────┬────────┘   │   │
│   │        ▲               │                  │             │   │
│   │        └───────────────┴──────────────────┘             │   │
│   │                   (until <answer>)                      │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│   ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐   │
│   │ native tools │  │ContextManager│  │  SessionLogger     │   │
│   │ + parser.ts  │  │ trim + notice│  │  markdown/session  │   │
│   │ fallback     │  │ usage events │  │  ~/.config/ai-cli  │   │
│   │              │  └──────────────┘  └────────────────────┘   │
│   └──────────────┘   AgentRegistry · SkillLoader (markdown)     │
└────────────────────────┬────────────────────────────────────────┘
                         │
         ┌───────────────┴────────────────┐
         │                                │
┌────────▼──────────┐          ┌──────────▼──────────┐
│  Provider Layer   │          │     Tool Registry    │
│  (src/providers/) │          │     (src/tools/)     │
│                   │          │                      │
│  ┌─────────────┐  │          │  bash   ssh   git    │
│  │OllamaProvider│  │          │  fetch  glob  grep   │
│  │+ tool_calls │  │          │  read/write/edit/    │
│  └─────────────┘  │          │  append/delete_file  │
│  ┌─────────────┐  │          │  download_file       │
│  │OpenAICompat │  │          │  ssh_upload/download │
│  │SSE stream   │  │          └──────────────────────┘
│  └─────────────┘  │
└───────────┬───────┘
            │
     ┌──────▼──────┐
     │   Ollama    │
     │  (local)    │
     │  port 11434 │
     └─────────────┘
```

---

## Agents

An agent is a named persona with a scoped tool set. Pick one with `--agent <id>` (default `build`):

| Agent | Purpose | Tool access |
|---|---|---|
| `build` | Full-access development work | all tools |
| `plan` | Read-only analysis — no mutations, no shell | `read_file`, `glob`, `grep`, `git`, `fetch` |
| `cli` | Shell and infrastructure | `bash`, `ssh`, `ssh_upload`, `ssh_download`, `fetch`, `download_file` |

A tool the active agent isn't allowed to call is rejected before it runs, and the system prompt only describes permitted tools.

### Custom agents

Drop a markdown file in `~/.config/ai-cli/agents/<name>.md`:

```markdown
---
name: reviewer
description: Review code changes — read-only
tools: [read_file, glob, grep, git]
readonly: true
---
You are a code reviewer. Focus on correctness and clarity.
```

Then run `iaa run --agent reviewer "review the diff"`. List all agents with `iaa agents`.

---

## Skills

A skill is a reusable instruction overlay that extends the system prompt without changing tool access. Put one in `~/.config/ai-cli/skills/<name>.md`:

```markdown
---
name: refactor
description: Refactor TypeScript for strict-mode compliance
args:
  - name: target
    description: File or directory to refactor
    required: true
---
Refactor with strict null checks and no implicit any. Target: {{target}}
```

Invoke it:

```bash
iaa run --skill refactor --skill-arg target=src/tools/bash.ts "clean this up"
iaa run /refactor src/tools/bash.ts          # shorthand, positional args
```

Skills compose (`--skill a --skill b`). List them with `iaa skills`.

---

## Tool system

### Built-in tools

| Tool | Description |
|---|---|
| `bash` | Execute any shell command. 30s timeout, 10MB buffer, `execFile` (no shell injection). |
| `ssh` | Run a command on a remote server. Password from `SSH_PASS` env, ControlMaster persistence, Wake-on-LAN. |
| `ssh_upload` / `ssh_download` | Transfer files to/from a remote host via `scp` (key auth, or `sshpass` for passwords). |
| `git` | Safe subcommands: `status`, `diff`, `log`, `add`, `commit`, `branch`, `checkout`, `show`, `stash`. Destructive ops blocked. |
| `fetch` | HTTP(S) GET/POST. Follows ≤5 redirects, strips HTML to text, truncates to 8 KB, 15s timeout. |
| `read_file` | Read a file. Optional `start_line`/`end_line` ranges; rejects whole-file reads over 150 KB. |
| `write_file` | Write content to a file, creating parent directories as needed. |
| `edit_file` | Replace a line range and return a unified diff. `end = start - 1` inserts; empty content deletes. |
| `append_file` | Append to a file without overwriting; creates it if missing. |
| `delete_file` | Delete a single file or empty dir. Refuses wildcards and `.git` paths. |
| `download_file` | Stream a URL to disk with no size limit (≤5 redirects, 120s timeout). |
| `glob` | Find files by glob pattern. |
| `grep` | Search file contents (ripgrep with grep fallback). |

### SSH + Wake-on-LAN

```bash
# Password auth (reads SSH_PASS env var)
SSH_PASS="yourpassword" iaa run "ssh into 192.168.1.50 as dan and show disk usage" -v

# Wake a sleeping machine, then connect
iaa run "ssh into 192.168.1.50 as dan — wake MAC is aa:bb:cc:dd:ee:ff — run docker ps" -v
```

### Adding a custom tool

Create a file in `src/tools/` and add it to `getDefaultTools()` in `src/tools/index.ts`. The tool description is automatically injected into the system prompt.

```typescript
import type { Tool, ToolResult } from "../types.js";

const myTool: Tool = {
  definition: {
    name: "my_tool",
    description: "What this tool does and when the agent should use it.",
    parameters: {
      type: "object",
      properties: {
        input: { type: "string", description: "The input to process" },
      },
      required: ["input"],
    },
  },
  async execute(args): Promise<ToolResult> {
    const input = String(args.input ?? "");
    try {
      const output = await doSomething(input);
      return { success: true, data: output };
    } catch (err: any) {
      return { success: false, data: "", error: err.message };
    }
  },
};
```

Rules: `execute()` never throws, `data` is what the model reads, coerce all args defensively.

---

## Optimised for local LLMs

The primary target is `qwen2.5-coder:7b` on Ollama. Several design decisions exist for its specific behaviour:

| Decision | Why |
|---|---|
| Native function calling, with parser fallback | Capable models emit structured `tool_calls`; the `<thought>`/`<tool_call>`/`<answer>` text parser still catches responses that come back as text |
| XML-tagged prompting (`<thought>`, `<tool_call>`, `<answer>`) | qwen2.5-coder is reliable with XML delimiters; prose-based prompts cause format drift |
| Temperature 0.15 | Structured output requires low temperature; higher values cause format and JSON breakage |
| `num_predict: 8192` | 7b models produce longer reasoning chains than expected; prevents mid-thought truncation |
| 24 576-token context cap | 32k model window minus 8k output headroom |
| Numbered imperative rules in system prompt | qwen2.5-coder follows numbered rules more reliably than prose bullets |
| OS injected into system prompt | Model uses correct platform commands (macOS vs Linux) without guessing |

Works well with `mistral:7b` and other instruction-tuned Ollama models. Switch model with:

```bash
iaa config --set-model mistral:7b
# or per-run:
iaa run "my task" -m mistral:7b
```

---

## Development

```bash
pnpm build             # compile TypeScript → dist/
pnpm typecheck         # type-check without emitting
pnpm test              # run test suite (Vitest)
pnpm dev -- run "task" -v   # run from source with tsx
pnpm add -g .          # update global binary after build
```

After any source change: `pnpm build && pnpm add -g .`

---

## Contributing

This project is in early alpha. Issues and PRs are welcome.

- **Bug reports** — open an issue with the task you ran, model used, and the output
- **New tools** — follow the pattern in `src/tools/bash.ts`, open a PR with tests
- **Provider support** — implement the `Provider` interface in `src/providers/`

Please run `pnpm build && pnpm test` before submitting a PR.

---

## Licence

[MIT](./LICENSE) © 2026 devdaviddr
