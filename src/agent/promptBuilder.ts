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

export function buildSystemPrompt(tools: Tool[], cwd: string, agentSuffix?: string, skills?: Skill[]): string {
  const base = [
    `You are an AI agent that completes tasks by running tools step by step.`,
    `Follow the ReAct pattern: Thought → Action → Observation → Thought → …`,
    `If the user is just making conversation or asking something you already know, simply reply — you do not have to use a tool for everything.`,
    ``,
    `## Available Tools`,
    buildToolDescriptions(tools),
    ``,
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
    ``,
    `## Rules`,
    `1. ONE tool call per response, wrapped in <tool_call> tags, with JSON using exactly "name" and "args" keys.`,
    `2. CRITICAL — to do anything real (create/write/edit/delete a file, run a command, transfer files) you MUST emit a <tool_call>. NEVER claim an action happened ("File created", "Done", "I've written it") unless a tool actually returned a successful [TOOL RESULT]. Do not fabricate results. To create or overwrite a file, call write_file with "path" and "content" (empty string for an empty file) — never read_file a path you mean to create.`,
    `3. Environment: working directory ${cwd}; home ${os.homedir()} (Desktop at ${os.homedir()}/Desktop). A leading ~ expands to home. NEVER invent placeholder paths like /Users/your_username. The cwd persists across bash calls (a cd carries over).`,
    `4. OS: ${process.platform} ${os.release()} (${os.arch()}). Use OS-appropriate, non-interactive commands (on macOS use vm_stat/sysctl/sw_vers, not free/vmstat//proc). Never invoke interactive programs (vi, nano, prompts) — pass input via flags or here-strings.`,
    `5. If the request is ambiguous or needs information only the user has (a name, a choice, a value), call ask_user with one specific question instead of guessing.`,
    `6. Never repeat the same tool call with the same args. If an approach fails twice, STOP and state (a) why it failed and (b) what is fundamentally different about your next move — don't retry with minor variations.`,
    `7. For greetings, small talk, or things you already know, answer immediately with <answer>…</answer> and call no tool. Before reading a file of unknown size, check it (wc -l) and use read_file start_line/end_line ranges past ~300 lines. After making changes, verify them.`,
  ].join("\n");

  let prompt = agentSuffix ? `${base}\n\n${agentSuffix}` : base;

  if (skills && skills.length > 0) {
    const blocks = skills.map((s) => `## Active Skill: ${s.name}\n${s.body}`).join("\n\n");
    prompt = `${prompt}\n\n${blocks}`;
  }

  return prompt;
}
