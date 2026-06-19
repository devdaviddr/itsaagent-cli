import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ToolResult } from "../types.js";

export class SessionLogger {
  private path: string = "";
  private readonly startTime: number = Date.now();
  private readonly enabled: boolean;

  constructor(logDir?: string) {
    this.enabled = !!logDir;
    if (logDir) {
      const dir = logDir.startsWith("~") ? join(homedir(), logDir.slice(1)) : logDir;
      const ts = new Date().toISOString().replace("T", "_").replace(/[:.]/g, "-").slice(0, 19);
      this.path = join(dir, `session-${ts}.md`);
    }
  }

  async init(task: string, model: string, cwd: string): Promise<void> {
    if (!this.enabled) return;
    await mkdir(join(this.path, ".."), { recursive: true });
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    await writeFile(
      this.path,
      [
        `# Session ${now}`,
        ``,
        `| | |`,
        `|---|---|`,
        `| **Model** | ${model} |`,
        `| **CWD** | \`${cwd}\` |`,
        `| **Task** | ${task} |`,
        ``,
        `---`,
        ``,
      ].join("\n"),
      "utf-8",
    );
  }

  async logStep(
    step: number,
    thought: string | undefined,
    toolName: string,
    toolArgs: Record<string, unknown>,
    result: ToolResult,
  ): Promise<void> {
    if (!this.enabled) return;
    const status = result.success ? "✓" : "✗";
    const exitStr = result.exitCode !== undefined ? ` exit ${result.exitCode}` : "";
    const lines: string[] = [`## Step ${step}  ${status}${exitStr}`, ``];
    if (thought) lines.push(`> ${thought.replace(/\n/g, "\n> ")}`, ``);
    lines.push(`**Tool:** \`${toolName}\``, `\`\`\`json\n${JSON.stringify(toolArgs, null, 2)}\n\`\`\``, ``);
    if (result.data) {
      const preview = result.data.length > 3000 ? result.data.slice(0, 3000) + "\n…[truncated]" : result.data;
      lines.push(`**Output:**\n\`\`\`\n${preview}\n\`\`\``);
    }
    if (result.error) lines.push(`**Stderr:** \`${result.error.slice(0, 500)}\``);
    lines.push(``, `---`, ``);
    await appendFile(this.path, lines.join("\n"), "utf-8");
  }

  async logAnswer(answer: string): Promise<void> {
    if (!this.enabled) return;
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(1);
    await appendFile(
      this.path,
      [`## Answer`, ``, answer, ``, `---`, ``, `*Completed in ${duration}s*`, ``].join("\n"),
      "utf-8",
    );
  }

  async logError(message: string): Promise<void> {
    if (!this.enabled) return;
    await appendFile(this.path, `## Error\n\n${message}\n\n---\n\n`, "utf-8");
  }

  get filePath(): string { return this.path; }
  get isEnabled(): boolean { return this.enabled; }
}
