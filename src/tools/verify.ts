import { execFile } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Tool, ToolResult } from "../types.js";
import { getSessionCwd } from "./session.js";

const execFileAsync = promisify(execFile);

const TEST_TIMEOUT_MS = 120_000;
const MAX_OUTPUT = 4000;

/** Pick a test command for the project in `cwd`, or null if none is detected. */
export function detectTestCommand(cwd: string): string | null {
  // Node: a real `test` script, with the package manager matching the lockfile.
  const pkgPath = join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { scripts?: Record<string, string> };
      const testScript = pkg.scripts?.test ?? "";
      if (testScript && !/no test specified/i.test(testScript)) {
        const pm = existsSync(join(cwd, "pnpm-lock.yaml"))
          ? "pnpm"
          : existsSync(join(cwd, "yarn.lock"))
            ? "yarn"
            : "npm";
        return `${pm} test`;
      }
    } catch {
      /* fall through to other detectors */
    }
  }
  // Rust.
  if (existsSync(join(cwd, "Cargo.toml"))) return "cargo test";
  // Python: pytest if configured or any test file is present.
  const hasPyConfig =
    existsSync(join(cwd, "pyproject.toml")) || existsSync(join(cwd, "pytest.ini")) || existsSync(join(cwd, "setup.cfg"));
  let hasTestFile = false;
  try {
    hasTestFile = readdirSync(cwd).some((f) => /^test_.*\.py$/.test(f) || /_test\.py$/.test(f));
  } catch {
    /* ignore */
  }
  if (hasPyConfig || hasTestFile) return "pytest";
  // Make target named test.
  const mk = join(cwd, "Makefile");
  if (existsSync(mk)) {
    try {
      if (/^test:/m.test(readFileSync(mk, "utf-8"))) return "make test";
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Keep the head and tail of long test output (failures live at both ends). */
function clampOutput(out: string): string {
  if (out.length <= MAX_OUTPUT) return out;
  const head = out.slice(0, MAX_OUTPUT * 0.6);
  const tail = out.slice(-MAX_OUTPUT * 0.4);
  return `${head}\n…[trimmed]…\n${tail}`;
}

/**
 * `run_tests` — the verification primitive. Runs the project's test suite in the
 * session cwd and reports a normalized PASS/FAIL plus the relevant output, so the
 * agent (and the verification gate) can check that work actually succeeded instead
 * of trusting a claim.
 */
export const runTestsTool: Tool = {
  definition: {
    name: "run_tests",
    description:
      "Run the project's test suite to verify your work. Auto-detects the runner (npm/pnpm/yarn test, pytest, cargo test, or `make test`) in the current directory. Returns PASS or FAIL with the relevant output. Pass `command` to override the detected command.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Optional explicit test command to run instead of the auto-detected one" },
      },
      required: [],
    },
  },
  async execute(args): Promise<ToolResult> {
    const cwd = getSessionCwd();
    const override = String(args.command ?? "").trim();
    const command = override || detectTestCommand(cwd);
    if (!command) {
      return {
        success: false,
        data: "",
        error:
          "No test runner detected here (no package.json test script, pytest config/test files, Cargo.toml, or Makefile test target). Pass an explicit `command`, or add a test setup first.",
      };
    }
    try {
      const { stdout, stderr } = await execFileAsync("bash", ["-c", command], {
        cwd,
        timeout: TEST_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
      });
      const out = clampOutput([stdout, stderr].filter(Boolean).join("\n").trim());
      return { success: true, data: `PASS — \`${command}\`\n${out}`, exitCode: 0 };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
      if (e.message && /timed out/i.test(e.message)) {
        return { success: false, data: "", error: `Tests timed out after ${TEST_TIMEOUT_MS / 1000}s running \`${command}\`.` };
      }
      const out = clampOutput([e.stdout, e.stderr].filter(Boolean).join("\n").trim() || e.message || String(err));
      return { success: false, data: `FAIL — \`${command}\` (exit ${e.code ?? 1})\n${out}`, error: `Tests failed (exit ${e.code ?? 1}).`, exitCode: e.code ?? 1 };
    }
  },
};
