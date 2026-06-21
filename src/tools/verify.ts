import { execFile } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, extname, dirname } from "node:path";
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

const SYNTAX_TIMEOUT_MS = 10_000;
/** Cap on captured diagnostic output so a wall of errors can't blow the context. */
const DIAG_MAX_OUTPUT = 600;
const TSC_TIMEOUT_MS = 15_000;

/**
 * Run a fast syntax check on a code file. Returns a one-line result string,
 * or null if no checker applies to this file type. Never throws.
 *
 * Parse-level only (node --check / py_compile). For richer type/lint diagnostics
 * using locally-available tooling, see {@link checkDiagnostics}.
 */
export async function checkSyntax(filePath: string): Promise<string | null> {
  const ext = extname(filePath).toLowerCase();
  let bin: string;
  let args: string[];
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
    bin = "node";
    args = ["--check", filePath];
  } else if (ext === ".py") {
    bin = "python3";
    args = ["-m", "py_compile", filePath];
  } else {
    return null;
  }
  try {
    await execFileAsync(bin, args, { timeout: SYNTAX_TIMEOUT_MS });
    return "Syntax: PASS";
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string; message?: string };
    const msg = (e.stderr || e.stdout || e.message || String(err)).trim().slice(0, 400);
    return `Syntax: FAILED — ${msg}`;
  }
}

/** Walk up from `cwd` (at most `levels` parents) looking for `node_modules/.bin/<bin>`.
 * Returns the absolute path to the binary if found locally, else null. */
function findLocalBin(cwd: string, bin: string, levels = 3): string | null {
  let dir = cwd;
  for (let i = 0; i <= levels; i++) {
    const candidate = join(dir, "node_modules", ".bin", bin);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** True if `bin` resolves on PATH (used for ruff). Never throws. */
async function onPath(bin: string): Promise<boolean> {
  try {
    await execFileAsync(process.platform === "win32" ? "where" : "which", [bin], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/** Collapse captured tool output to a short summary capped at DIAG_MAX_OUTPUT chars. */
function summariseDiag(out: string): string {
  const trimmed = out.trim();
  if (trimmed.length <= DIAG_MAX_OUTPUT) return trimmed;
  return trimmed.slice(0, DIAG_MAX_OUTPUT) + "\n…[trimmed]";
}

/**
 * Feed REAL linter/type diagnostics back to the model after a write/edit, using
 * ONLY locally-available tooling (never triggers an install, never blocks long,
 * never throws). Returns a one-line/short summary, or null when no local checker
 * applies. Tight timeouts and capped output keep it cheap.
 *
 * - .ts/.tsx → local `tsc --noEmit --skipLibCheck <file>` if present (else null —
 *   we never fall back to `node --check`, which false-fails on TS syntax).
 * - .js/.jsx/.mjs/.cjs → local `eslint --format compact <file>` if present, else
 *   the parse-level `node --check` fallback.
 * - .py → `ruff check <file>` if ruff is on PATH, else `python3 -m py_compile`.
 */
export async function checkDiagnostics(filePath: string, cwd: string): Promise<string | null> {
  try {
    const ext = extname(filePath).toLowerCase();

    if (ext === ".ts" || ext === ".tsx") {
      const tsc = findLocalBin(cwd, "tsc");
      if (!tsc) return null; // no local tsc — do NOT fall back to node --check on TS
      try {
        await execFileAsync(tsc, ["--noEmit", "--skipLibCheck", filePath], { timeout: TSC_TIMEOUT_MS, cwd });
        return "Diagnostics (tsc): PASS";
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; message?: string };
        return `Diagnostics (tsc): ${summariseDiag(e.stdout || e.stderr || e.message || "failed")}`;
      }
    }

    if ([".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
      const eslint = findLocalBin(cwd, "eslint");
      if (eslint) {
        try {
          await execFileAsync(eslint, ["--format", "compact", filePath], { timeout: 10_000, cwd });
          return "Diagnostics (eslint): PASS";
        } catch (err: unknown) {
          const e = err as { stdout?: string; stderr?: string; message?: string };
          return `Diagnostics (eslint): ${summariseDiag(e.stdout || e.stderr || e.message || "failed")}`;
        }
      }
      // No local eslint — fall back to a parse check.
      return checkSyntax(filePath);
    }

    if (ext === ".py") {
      if (await onPath("ruff")) {
        try {
          await execFileAsync("ruff", ["check", filePath], { timeout: 10_000, cwd });
          return "Diagnostics (ruff): PASS";
        } catch (err: unknown) {
          const e = err as { stdout?: string; stderr?: string; message?: string };
          return `Diagnostics (ruff): ${summariseDiag(e.stdout || e.stderr || e.message || "failed")}`;
        }
      }
      return checkSyntax(filePath);
    }

    return null;
  } catch {
    return null; // diagnostics are best-effort — never throw
  }
}
