import { execFile } from "node:child_process";
import { chmod, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Tool, ToolResult } from "../types.js";

const execFileAsync = promisify(execFile);
const SOCKET_DIR = join(tmpdir(), "itsaagent-ssh");

function socketPath(user: string, host: string, port: number): string {
  const safe = `${user}_${host.replace(/[^a-zA-Z0-9.-]/g, "_")}_${port}`;
  return join(SOCKET_DIR, `${safe}.sock`);
}

function isPermDenied(stderr: string): boolean {
  const s = stderr.toLowerCase();
  return s.includes("permission denied") || s.includes("not in the sudoers") || s.includes("access denied");
}

function isConnError(stderr: string): boolean {
  const s = stderr.toLowerCase();
  return (
    s.includes("connection refused") ||
    s.includes("connection timed out") ||
    s.includes("no route to host") ||
    s.includes("operation timed out") ||
    s.includes("name or service not known") ||
    s.includes("network is unreachable")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function tryPing(host: string): Promise<boolean> {
  // -W for Linux, -t for macOS/BSD; try both
  const args = process.platform === "darwin"
    ? ["-c", "1", "-t", "5", host]
    : ["-c", "1", "-W", "5", host];
  try {
    await execFileAsync("ping", args, { timeout: 7000 });
    return true;
  } catch {
    return false;
  }
}

async function wakeAndWait(mac: string, host: string, waitSec: number): Promise<boolean> {
  try {
    await execFileAsync("wakeonlan", [mac], { timeout: 5000 });
  } catch { /* non-fatal */ }

  const deadline = Date.now() + waitSec * 1000;
  while (Date.now() < deadline) {
    if (await tryPing(host)) return true;
    await sleep(3000);
  }
  return false;
}

/** Build a clean env for child processes — strips SSH_PASS to prevent leakage */
function safeEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const { SSH_PASS: _stripped, ...clean } = process.env;
  return extra ? { ...clean, ...extra } : clean;
}

async function ensureSocketDir(): Promise<void> {
  await mkdir(SOCKET_DIR, { recursive: true });
  // Restrict permissions so other users on the system cannot access SSH sockets
  await chmod(SOCKET_DIR, 0o700);
}

async function runSshCommand(
  host: string,
  user: string,
  command: string,
  port: number,
  keyPath: string,
): Promise<ToolResult> {
  // Password resolved from environment only — never from tool args
  const pw = process.env.SSH_PASS ?? "";

  await ensureSocketDir();
  const socket = socketPath(user, host, port);

  const sshBaseArgs = [
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=10",
    "-o", "ControlMaster=auto",
    "-o", `ControlPath=${socket}`,
    "-o", "ControlPersist=120",
  ];

  if (port !== 22) sshBaseArgs.push("-p", String(port));
  if (keyPath) sshBaseArgs.push("-i", keyPath);
  // user@host and command passed as discrete execFile args — no shell interpolation
  sshBaseArgs.push(`${user}@${host}`, "bash", "-c", command);

  const execOpts = {
    timeout: 60000,
    maxBuffer: 10 * 1024 * 1024,
    env: pw ? safeEnv({ SSHPASS: pw }) : safeEnv(),
  };

  try {
    const [bin, args] = pw
      ? (["sshpass", ["-e", "ssh", ...sshBaseArgs]] as const)
      : (["ssh", sshBaseArgs] as const);

    const { stdout, stderr } = await execFileAsync(bin, args, execOpts);
    const hasError = !!stderr && !stderr.startsWith("Warning:");
    return { success: !hasError, data: stdout, error: stderr || undefined, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    const stderr = e.stderr ?? "";

    if (isPermDenied(stderr)) {
      return {
        success: false,
        data: e.stdout ?? "",
        error: `Permission denied. Try running the command with sudo explicitly. stderr: ${stderr}`,
        exitCode: e.code ?? 1,
      };
    }

    return {
      success: false,
      data: e.stdout ?? "",
      error: stderr || (err instanceof Error ? err.message : String(err)),
      exitCode: e.code ?? 1,
    };
  }
}

export const sshTool: Tool = {
  definition: {
    name: "ssh",
    description:
      "Run a command on a remote server via SSH. Set SSH_PASS env var for password auth. " +
      "Provide wake_mac to auto-wake a sleeping server via Wake-on-LAN before connecting.",
    parameters: {
      type: "object",
      properties: {
        host: { type: "string", description: "Remote host (IP or hostname)" },
        user: { type: "string", description: "SSH username" },
        command: { type: "string", description: "Command to run on the remote host" },
        port: { type: "string", description: "SSH port (default: 22)" },
        key_path: { type: "string", description: "Path to SSH private key file" },
        wake_mac: { type: "string", description: "MAC address for Wake-on-LAN if the server is asleep" },
        wake_timeout: { type: "string", description: "Seconds to wait for WoL wake-up (default: 90)" },
      },
      required: ["host", "user", "command"],
    },
  },
  async execute(args): Promise<ToolResult> {
    const host = String(args.host ?? "");
    const user = String(args.user ?? "");
    const command = String(args.command ?? "");
    const port = Number(args.port ?? 22);
    const keyPath = String(args.key_path ?? "");
    const wakeMac = args.wake_mac ? String(args.wake_mac) : (process.env.WOL_MAC ?? "");
    const wakeTimeout = Number(args.wake_timeout ?? 90);

    const result = await runSshCommand(host, user, command, port, keyPath);

    if (result.success || !isConnError(result.error ?? "")) {
      return result;
    }

    if (!wakeMac) return result;

    console.error(`  [ssh] ${host} unreachable — sending WoL to ${wakeMac}`);
    const woke = await wakeAndWait(wakeMac, host, wakeTimeout);
    if (!woke) {
      return {
        success: false,
        data: "",
        error: `Sent WoL to ${wakeMac} but ${host} did not respond within ${wakeTimeout}s`,
      };
    }

    console.error(`  [ssh] ${host} is back — retrying`);
    return runSshCommand(host, user, command, port, keyPath);
  },
};
