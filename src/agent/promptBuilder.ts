import os from "node:os";
import type { Tool, Skill } from "../types.js";

export function buildToolDescriptions(tools: Tool[]): string {
  return tools
    .map((t) => {
      const props = Object.entries(t.definition.parameters.properties)
        .map(([k, v]) => `    ${k}: ${v.type} — ${v.description}`)
        .join("\n");
      const req = t.definition.parameters.required.join(", ");
      return [
        `### ${t.definition.name}`,
        t.definition.description,
        `Parameters:`,
        props || "    (none)",
        `Required: [${req}]`,
      ].join("\n");
    })
    .join("\n\n");
}

export interface PromptOptions {
  /** Include one worked few-shot trajectory (default true). Small models follow the protocol far better with an example. */
  fewShot?: boolean;
  /** The model uses native function-calling; drop the XML <tool_call> format from the prompt. */
  nativeTools?: boolean;
  /** Pre-formatted project-context block (from AGENTS.md) to pin into the prompt. */
  projectContext?: string;
}

/** One short worked trajectory: Thought → tool call → [TOOL RESULT] → wait → answer.
 * Teaches the protocol (and that you answer only AFTER the result confirms success). */
function buildFewShot(native: boolean): string {
  const call = native
    ? ['(call write_file with {"path": "notes/todo.txt", "content": "buy milk"})']
    : ["<tool_call>", '{"name": "write_file", "args": {"path": "notes/todo.txt", "content": "buy milk"}}', "</tool_call>"];
  return [
    "## Example (follow this shape)",
    "<thought>",
    "I need to create the file, so I will call write_file.",
    "</thought>",
    ...call,
    '[TOOL RESULT: write_file — OK] {"path":"notes/todo.txt"}',
    "Wrote 8 bytes to notes/todo.txt",
    "<thought>",
    "The result confirms the file was written, so the task is done.",
    "</thought>",
    "<answer>",
    'Created notes/todo.txt containing "buy milk".',
    "</answer>",
  ].join("\n");
}

export function buildSystemPrompt(tools: Tool[], cwd: string, agentSuffix?: string, skills?: Skill[], opts: PromptOptions = {}): string {
  const fewShot = opts.fewShot !== false;
  const native = opts.nativeTools === true;

  // Native function-calling vs the text <tool_call> protocol — teach exactly one,
  // so the model doesn't get contradictory "emit native" + "emit XML" instructions.
  const formatBlock = native
    ? [
        `## Response Format`,
        ``,
        `Reason in <thought>…</thought>. Then EITHER call exactly one of the provided tools directly (use the function-calling interface — do NOT write the call as text), OR, when the task is fully done, give your final answer:`,
        `<answer>`,
        `Your final answer here.`,
        `</answer>`,
      ]
    : [
        `## Response Format`,
        ``,
        `To call a tool:`,
        `<thought>`,
        `Your reasoning. On the first step, outline your plan before acting.`,
        `</thought>`,
        `<tool_call>`,
        `{"name": "tool_name", "args": {"param": "value"}}`,
        `</tool_call>`,
        ``,
        `To give your final answer when the task is complete:`,
        `<thought>`,
        `Task is complete. Summary of what was done.`,
        `</thought>`,
        `<answer>`,
        `Your final answer here.`,
        `</answer>`,
      ];

  const callVerb = native ? "call a tool" : "emit a <tool_call>";
  const rule1 = native
    ? `1. Make exactly ONE tool call per response by calling a provided tool directly (never write the call as text). Wrap your final answer in <answer></answer>.`
    : `1. ONE tool call per response, wrapped in <tool_call> tags, with JSON using exactly "name" and "args" keys.`;

  const base = [
    `You are an AI agent that completes tasks by running tools step by step.`,
    `Follow the ReAct pattern: Thought → Action → Observation → Thought → …`,
    `If the user is just making conversation or asking something you already know, simply reply — you do not have to use a tool for everything.`,
    ``,
    `## Available Tools`,
    buildToolDescriptions(tools),
    ``,
    ...formatBlock,
    ``,
    ...(fewShot ? [buildFewShot(native), ``] : []),
    `## Rules`,
    rule1,
    `2. CRITICAL — to do anything real (create/write/edit/delete a file, run a command, transfer files) you MUST ${callVerb}. NEVER claim an action happened ("File created", "Done", "I've written it") unless a tool actually returned a successful [TOOL RESULT]. Do not fabricate results. To create or overwrite a file, call write_file with "path" and "content" (empty string for an empty file) — never read_file a path you mean to create.`,
    `3. Environment: working directory ${cwd}; home ${os.homedir()} (Desktop at ${os.homedir()}/Desktop). A leading ~ expands to home. NEVER invent placeholder paths like /Users/your_username. The cwd persists across bash calls (a cd carries over). To make a folder use make_directory (never by writing an empty file); write_file makes any missing parent folders itself. When building inside a project folder, FIRST cd into it with one bash command (\`cd <folder>\` — that persists), THEN run every command and write every file with simple relative names, so package.json, node_modules and your files all land together in that folder. Don't repeat the folder name in each path, and don't mix cd-less commands with folder-prefixed paths.`,
    `4. OS: ${process.platform} ${os.release()} (${os.arch()}). Use OS-appropriate, non-interactive commands (on macOS use vm_stat/sysctl/sw_vers, not free/vmstat//proc). Never invoke interactive programs (vi, nano, prompts) — pass input via flags or here-strings. Always quote file paths in shell commands (they may contain spaces or apostrophes), e.g. ls -la "$HOME/Desktop/my project".`,
    `5. If the request is ambiguous or needs information only the user has (a name, a choice, a value), call ask_user with one specific question instead of guessing.`,
    `6. Never repeat the same tool call with the same args. If an approach fails twice, STOP and state (a) why it failed and (b) what is fundamentally different about your next move — don't retry with minor variations.`,
    `7. For greetings, small talk, or things you already know, answer immediately with <answer>…</answer> and call no tool. Before reading a file of unknown size, check it (wc -l) and use read_file start_line/end_line ranges past ~300 lines. After making changes, verify them.`,
  ].join("\n");

  let prompt = agentSuffix ? `${base}\n\n${agentSuffix}` : base;

  if (opts.projectContext) {
    prompt = `${prompt}\n\n${opts.projectContext}`;
  }

  if (skills && skills.length > 0) {
    const blocks = skills.map((s) => `## Active Skill: ${s.name}\n${s.body}`).join("\n\n");
    prompt = `${prompt}\n\n${blocks}`;
  }

  return prompt;
}
