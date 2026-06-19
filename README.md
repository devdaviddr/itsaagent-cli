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
- **Live TUI** — Ink-powered terminal UI with streaming output, step-by-step progress, and colour-coded status
- **Six built-in tools** — `bash`, `ssh`, `read_file`, `write_file`, `glob`, `grep`
- **SSH + Wake-on-LAN** — connects to remote servers, auto-wakes sleeping machines before retrying
- **Provider abstraction** — Ollama (default) or any OpenAI-compatible endpoint
- **Context management** — 24 576-token window, oldest-first eviction, system prompt and task always pinned
- **Session logging** — structured markdown log per run (`-v` or `-l`)
- **Extensible tool system** — add a new tool in one file, zero boilerplate
- **Loop detection** — aborts if the same tool is called 3× with identical arguments

---

## Requirements

- [Node.js](https://nodejs.org) 18+
- [Ollama](https://ollama.com) running locally

---

## Quick start

```bash
# Pull the recommended model
ollama pull qwen2.5-coder:7b

# Clone and install
git clone https://github.com/devdaviddr/itsaagent-cli.git
cd itsaagent-cli
npm install
npm run build
npm install -g .

# Verify everything is connected
iaa check

# Run a task
iaa run "list typescript files in this project and count lines of code" -v
```

---

## CLI reference

```
iaa run <task>       Execute a one-shot task
iaa chat             Interactive multi-turn session
iaa models           List available Ollama models
iaa check            Verify Ollama connection and model availability
iaa config           View or update persistent config
```

### Flags

| Flag | Description |
|---|---|
| `-v, --verbose` | Stream thoughts, tool calls, and results live. Also writes a session log. |
| `-l, --log` | Write session log only (no console output beyond the final answer) |
| `-m, --model <name>` | Override model for this run |
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
│   │ parser.ts    │  │ContextManager│  │  SessionLogger     │   │
│   │ 3-fallback   │  │ token trim   │  │  markdown/session  │   │
│   │ XML→legacy   │  │ pin sys+task │  │  ~/.config/ai-cli  │   │
│   │ →bare JSON   │  └──────────────┘  └────────────────────┘   │
│   └──────────────┘                                              │
└────────────────────────┬────────────────────────────────────────┘
                         │
         ┌───────────────┴────────────────┐
         │                                │
┌────────▼──────────┐          ┌──────────▼──────────┐
│  Provider Layer   │          │     Tool Registry    │
│  (src/providers/) │          │     (src/tools/)     │
│                   │          │                      │
│  ┌─────────────┐  │          │  bash      glob      │
│  │OllamaProvider│  │          │  read_file grep      │
│  │NDJSON stream│  │          │  write_file ssh       │
│  └─────────────┘  │          │                      │
│  ┌─────────────┐  │          └──────────────────────┘
│  │OpenAICompat │  │
│  │SSE stream   │  │
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

## Tool system

### Built-in tools

| Tool | Description |
|---|---|
| `bash` | Execute any shell command. 30s timeout, 10MB buffer, `execFile` (no shell injection). |
| `ssh` | Run a command on a remote server. Password from `SSH_PASS` env, ControlMaster persistence, Wake-on-LAN. |
| `read_file` | Read a file's contents. |
| `write_file` | Write content to a file, creating parent directories as needed. |
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
| XML-tagged prompting (`<thought>`, `<tool_call>`, `<answer>`) | qwen2.5-coder is reliable with XML delimiters; prose-based prompts cause format drift |
| 3-fallback response parser | Model frequently omits `<tool_call>` wrapper — bare JSON fallback keeps the agent running |
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
npm run build          # compile TypeScript → dist/
npm run typecheck      # type-check without emitting
npm test               # run test suite (Vitest)
npm run dev -- run "task" -v   # run from source with tsx
npm install -g .       # update global binary after build
```

After any source change: `npm run build && npm install -g .`

---

## Contributing

This project is in early alpha. Issues and PRs are welcome.

- **Bug reports** — open an issue with the task you ran, model used, and the output
- **New tools** — follow the pattern in `src/tools/bash.ts`, open a PR with tests
- **Provider support** — implement the `Provider` interface in `src/providers/`

Please run `npm run build && npm test` before submitting a PR.

---

## Licence

[MIT](./LICENSE) © 2026 devdaviddr
