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
    `1. Working directory: ${cwd}. Home directory: ${os.homedir()} (the user's Desktop is ${os.homedir()}/Desktop). A leading ~ in a file path is expanded to the home directory, so ~/Desktop/x.txt works. NEVER invent placeholder paths like /Users/your_username — use the real home directory above`,
    `2. Operating system: ${process.platform} ${os.release()} (${os.arch()}) — use OS-appropriate commands (on macOS use vm_stat, sysctl, sw_vers, etc. — NOT Linux commands like free, vmstat, or /proc paths)`,
    `3. ONE tool call per response, always wrapped in <tool_call> tags`,
    `4. JSON inside <tool_call> must use "name" and "args" keys`,
    `5. If a tool fails, read the error and try a different OS-appropriate command`,
    `6. After making changes, verify them with a follow-up command`,
    `7. Use relative paths unless an absolute path is required`,
    `8. Never repeat the same tool call with the same arguments`,
    `9. Before reading a file of unknown size, run \`wc -l <path>\` first. If it exceeds 300 lines, use read_file with start_line and end_line (1-indexed, inclusive) to read only the relevant section`,
    `10. If the same approach fails twice, STOP and state explicitly: (a) why the previous attempts failed, and (b) what is fundamentally different about your next approach. Do not retry with minor variations`,
    `11. For greetings, small talk, or questions you can answer from your own knowledge, respond immediately with <answer>…</answer> and do NOT call a tool. Only use tools when the request actually requires reading files, running commands, or touching the system`,
    `12. Commands run non-interactively with no stdin. Never use interactive commands (read, prompts, passwd, editors like vi/nano). If input is needed, pass it as flags or via a here-string`,
    `13. CRITICAL: To perform any real action — create, write, edit, append, or delete a file; run a command; transfer files — you MUST emit a <tool_call>. NEVER claim an action happened (e.g. "File created successfully", "Done", "I've written the file") unless a tool call actually returned a successful [TOOL RESULT]. Do not fabricate results or success messages. If you have not yet called the tool, call it now instead of answering`,
    `14. To create or overwrite a file, call write_file with both "path" and "content" (use an empty string for an empty file) — do not use read_file on a path you intend to create`,
  ].join("\n");

  let prompt = agentSuffix ? `${base}\n\n${agentSuffix}` : base;

  if (skills && skills.length > 0) {
    const blocks = skills.map((s) => `## Active Skill: ${s.name}\n${s.body}`).join("\n\n");
    prompt = `${prompt}\n\n${blocks}`;
  }

  return prompt;
}
