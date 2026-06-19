import os from "node:os";
import type { Tool } from "../types.js";

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

export function buildSystemPrompt(tools: Tool[], cwd: string, agentSuffix?: string): string {
  const base = [
    `You are an AI agent that completes tasks by running tools step by step.`,
    `Follow the ReAct pattern: Thought → Action → Observation → Thought → …`,
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
    `1. Working directory: ${cwd}`,
    `2. Operating system: ${process.platform} ${os.release()} (${os.arch()}) — use OS-appropriate commands (on macOS use vm_stat, sysctl, sw_vers, etc. — NOT Linux commands like free, vmstat, or /proc paths)`,
    `3. ONE tool call per response, always wrapped in <tool_call> tags`,
    `4. JSON inside <tool_call> must use "name" and "args" keys`,
    `5. If a tool fails, read the error and try a different OS-appropriate command`,
    `6. After making changes, verify them with a follow-up command`,
    `7. Use relative paths unless an absolute path is required`,
    `8. Never repeat the same tool call with the same arguments`,
  ].join("\n");

  return agentSuffix ? `${base}\n\n${agentSuffix}` : base;
}
