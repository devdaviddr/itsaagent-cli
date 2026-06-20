/**
 * End-to-end functional test harness for ItsAAgent.
 *
 * Unlike the Vitest unit suite (`pnpm test`), this drives the *real* agent
 * runtime against a *live* Ollama model and asserts on real effects — files
 * created on disk, context remembered across turns, a plan handed from the
 * `plan` agent to the `build` agent. It is therefore slow and mildly
 * non-deterministic (it depends on the model), so it lives outside the unit
 * suite and is run on demand:
 *
 *   pnpm e2e                       # run every scenario on the configured model
 *   pnpm e2e -- --only handoff     # run scenarios whose name contains "handoff"
 *   pnpm e2e -- --model mistral:7b # override the model
 *   pnpm e2e -- --list             # list scenarios without running
 *   pnpm e2e -- --retries 2        # retry a failing scenario up to N times
 *   pnpm e2e -- --keep             # keep the scratch dir for inspection
 *
 * Each scenario gets its own clean scratch directory under the OS temp dir,
 * and the process/session cwd is pointed at it, so nothing ever touches the
 * user's real home directory.
 */
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

import { AgentRuntime } from "../../src/agent/AgentRuntime.js";
import { AgentRegistry } from "../../src/agent/AgentRegistry.js";
import type { AgentDefinition } from "../../src/agent/AgentDefinition.js";
import { loadConfig, toAgentConfig } from "../../src/cli/config.js";
import { setSessionCwd } from "../../src/tools/session.js";

// ---------------------------------------------------------------------------
// Tiny ANSI helpers (no dependencies)
// ---------------------------------------------------------------------------
const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
function flag(name: string): boolean {
  return argv.includes(`--${name}`);
}
function opt(name: string, fallback?: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
}

const ONLY = opt("only");
const MODEL_OVERRIDE = opt("model");
const RETRIES = Number(opt("retries", "1"));
const TIMEOUT_MS = Number(opt("timeout", "240")) * 1000;
const KEEP = flag("keep");
const LIST = flag("list");

const REPO_ROOT = process.cwd();
const SCRATCH_ROOT = join(os.tmpdir(), "iaa-e2e");

// ---------------------------------------------------------------------------
// Test context + assertions
// ---------------------------------------------------------------------------
interface Ctx {
  /** Scratch directory for this scenario (already the process + session cwd). */
  dir: string;
  /** Build a runtime scoped to an agent, with event capture wired up. */
  runtime(agentId: string): Promise<RuntimeBundle>;
  /** Look up a built-in agent definition (build / plan). */
  agent(id: string): AgentDefinition;
}

interface RuntimeBundle {
  rt: AgentRuntime;
  /** Tool names called during the run, in order. */
  toolsUsed: string[];
  /** Questions the agent asked via ask_user. */
  asks: string[];
}

class AssertionError extends Error {}
function fail(msg: string): never {
  throw new AssertionError(msg);
}

function read(dir: string, rel: string): string {
  return readFileSync(join(dir, rel), "utf-8");
}
function fileExists(dir: string, rel: string): void {
  if (!existsSync(join(dir, rel))) fail(`expected file to exist: ${rel}`);
}
function dirExists(dir: string, rel: string): void {
  const p = join(dir, rel);
  if (!existsSync(p) || !statSync(p).isDirectory()) fail(`expected directory to exist: ${rel}`);
}
function fileContains(dir: string, rel: string, needle: string): void {
  fileExists(dir, rel);
  const body = read(dir, rel).toLowerCase();
  if (!body.includes(needle.toLowerCase())) fail(`file ${rel} should contain "${needle}"`);
}
function contains(haystack: string, needle: string, label = "output"): void {
  if (!haystack.toLowerCase().includes(needle.toLowerCase())) {
    fail(`${label} should contain "${needle}" — got: ${truncate(haystack, 200)}`);
  }
}
function notContains(haystack: string, needle: string, label = "output"): void {
  if (haystack.toLowerCase().includes(needle.toLowerCase())) {
    fail(`${label} should NOT contain "${needle}" — got: ${truncate(haystack, 200)}`);
  }
}
/** Recursively list files (relative paths) under a directory, skipping node_modules. */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string, prefix: string): void => {
    for (const name of readdirSync(d)) {
      if (name === "node_modules" || name === ".git") continue;
      const abs = join(d, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (statSync(abs).isDirectory()) walk(abs, rel);
      else out.push(rel);
    }
  };
  walk(dir, "");
  return out;
}
function truncate(s: string, n: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n) + "…" : flat;
}

// ---------------------------------------------------------------------------
// Scenario registry
// ---------------------------------------------------------------------------
interface Scenario {
  name: string;
  desc: string;
  run(ctx: Ctx): Promise<void>;
}
const scenarios: Scenario[] = [];
function scenario(name: string, desc: string, run: (ctx: Ctx) => Promise<void>): void {
  scenarios.push({ name, desc, run });
}

// 1. Plain conversation — the model should answer directly with no tool call.
scenario("simple-chat", "Answers a conversational prompt without using a tool", async (ctx) => {
  const { rt, toolsUsed } = await ctx.runtime("build");
  const answer = await rt.run('Reply with exactly the single word: PONG. No punctuation, no explanation.');
  contains(answer, "pong");
  if (toolsUsed.length > 0) fail(`should not have called any tool, but used: ${toolsUsed.join(", ")}`);
});

// 2. Shell command via bash — exercises the bash tool + OS-appropriate behaviour.
scenario("shell-command", "Runs a shell command and reports the result", async (ctx) => {
  writeFileSync(join(ctx.dir, "a.txt"), "x");
  writeFileSync(join(ctx.dir, "b.txt"), "y");
  const { rt, toolsUsed } = await ctx.runtime("build");
  const answer = await rt.run(
    "Using a shell command, count how many files are in the current directory and tell me the number.",
  );
  if (!toolsUsed.includes("bash")) fail(`expected the bash tool to be used, used: ${toolsUsed.join(", ") || "none"}`);
  contains(answer, "2");
});

// 3. File creation — the headline "create a file" capability.
scenario("file-creation", "Creates a file with the requested content", async (ctx) => {
  const { rt } = await ctx.runtime("build");
  await rt.run('Create a file named hello.txt in the current directory containing exactly: hello world');
  fileContains(ctx.dir, "hello.txt", "hello world");
});

// 4. Folder + nested file creation.
scenario("folder-creation", "Creates a directory with a file inside it", async (ctx) => {
  const { rt } = await ctx.runtime("build");
  await rt.run(
    'Create a directory named project in the current directory, and inside it a file named notes.txt containing exactly: inside the folder',
  );
  dirExists(ctx.dir, "project");
  fileContains(ctx.dir, "project/notes.txt", "inside the folder");
});

// 5. Context memory WITHIN a run — must use an earlier tool result to answer.
scenario("context-memory", "Uses an earlier tool result later in the same run", async (ctx) => {
  writeFileSync(join(ctx.dir, "secret.txt"), "The access code is 4271.\n");
  const { rt, toolsUsed } = await ctx.runtime("build");
  const answer = await rt.run("Read the file secret.txt and tell me the access code it contains.");
  if (!toolsUsed.includes("read_file") && !toolsUsed.includes("bash")) {
    fail(`expected a read (read_file/bash), used: ${toolsUsed.join(", ") || "none"}`);
  }
  contains(answer, "4271");
});

// 6. Chat memory ACROSS turns — continueChat must preserve earlier turns.
scenario("chat-memory", "Remembers facts across chat turns (continueChat)", async (ctx) => {
  const { rt } = await ctx.runtime("build");
  rt.initSession();
  await rt.continueChat("My name is Ada and my favourite number is 7. Please remember both.");
  const answer = await rt.continueChat("What is my name, and what is my favourite number?");
  contains(answer, "ada");
  contains(answer, "7");
});

// 7. Session isolation — a fresh runtime must NOT recall another session's facts.
scenario("session-isolation", "A separate session does not leak prior context", async (ctx) => {
  const a = await ctx.runtime("build");
  a.rt.initSession();
  await a.rt.continueChat("Remember this: the passphrase is bluegiraffe. Acknowledge only.");

  // Brand-new runtime = brand-new session/context.
  const b = await ctx.runtime("build");
  const answer = await b.rt.run(
    "If I have told you a passphrase earlier, repeat it. If you have no record of one, reply exactly: NONE.",
  );
  notContains(answer, "bluegiraffe");
});

// 8. Plan agent is read-only — produces a plan, mutates nothing.
scenario("plan-readonly", "Plan agent produces a plan and creates no files", async (ctx) => {
  const { rt, toolsUsed } = await ctx.runtime("plan");
  const answer = await rt.run(
    "Plan (do not build) how to create a minimal Node script named app.js that prints hello. Give numbered steps.",
  );
  // No mutation tools should have run.
  for (const t of ["write_file", "edit_file", "append_file", "delete_file", "bash"]) {
    if (toolsUsed.includes(t)) fail(`plan agent must not call ${t} (used: ${toolsUsed.join(", ")})`);
  }
  // Nothing should have been written to disk.
  const files = listFiles(ctx.dir);
  if (files.length > 0) fail(`plan agent should create no files, found: ${files.join(", ")}`);
  // It should have produced a real, non-trivial plan.
  if (answer.trim().length < 30) fail(`expected a substantive plan, got: ${truncate(answer, 120)}`);
});

// 9. THE headline: plan an Express API, then hand the plan off to build to execute.
scenario("handoff-express", "Plan → build handoff actually builds the Express API", async (ctx) => {
  const planB = await ctx.runtime("plan");
  const plan = await planB.rt.run(
    "Plan a minimal Express API in the current directory: a package.json declaring express as a dependency, " +
      "and an index.js that starts an Express server on port 3000 with a GET / route returning 'hello'. " +
      "Do NOT run npm install. Output concrete, numbered steps with the file contents.",
  );
  if (plan.trim().length < 30) fail(`plan stage produced no usable plan: ${truncate(plan, 120)}`);

  // Hand the SAME session off to build (mirrors pressing Tab in the TUI).
  const buildDef = ctx.agent("build");
  const answer = await planB.rt.handoffToBuild(buildDef, plan);

  // The session should record the plan → build transition.
  const transitions = planB.rt.session.transitions;
  const handed = transitions.some((t) => t.from === "plan" && t.to === "build");
  if (!handed) fail(`expected a plan → build transition, got: ${JSON.stringify(transitions)}`);

  // The Express project must actually exist on disk.
  fileContains(ctx.dir, "package.json", "express");
  const jsFiles = listFiles(ctx.dir).filter((f) => f.endsWith(".js"));
  if (jsFiles.length === 0) fail(`expected a server .js file, found: ${listFiles(ctx.dir).join(", ") || "nothing"}`);
  const server = jsFiles.map((f) => read(ctx.dir, f).toLowerCase()).join("\n");
  if (!server.includes("express")) fail("server file should require/use express");
  if (!server.includes("listen")) fail("server file should call .listen()");
  void answer;
});

// 10. ask_user — an ambiguous request should make the agent ask, and the
//     supplied answer should drive the result.
scenario("ask-user", "Asks the user for missing info and uses the answer", async (ctx) => {
  const { rt, toolsUsed, asks } = await ctx.runtime("build");
  // The handler stands in for the interactive user.
  rt.setAskUserHandler(async (q: string) => {
    void q;
    return "greeting.txt";
  });
  await rt.run(
    "Create a text file in the current directory containing exactly: hi there. " +
      "You do not know the filename — you MUST call ask_user to ask me for the filename before creating it.",
  );
  // Primary: the file named by the supplied answer exists with the content.
  fileContains(ctx.dir, "greeting.txt", "hi there");
  // Informational: confirm the clarification path was exercised.
  if (!toolsUsed.includes("ask_user") && asks.length === 0) {
    fail("expected the agent to call ask_user for the filename");
  }
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
async function buildCtx(dir: string, model: string, registry: AgentRegistry): Promise<Ctx> {
  return {
    dir,
    agent(id: string): AgentDefinition {
      const def = registry.get(id);
      if (!def) throw new Error(`unknown agent: ${id}`);
      return def;
    },
    async runtime(agentId: string): Promise<RuntimeBundle> {
      const conf = await loadConfig();
      const agentConfig = await toAgentConfig(conf, { agent: agentId, model, log: false });
      const rt = new AgentRuntime(agentConfig);
      const toolsUsed: string[] = [];
      const asks: string[] = [];
      rt.on("tool:call", ({ name }) => toolsUsed.push(name));
      rt.on("ask", ({ question }) => asks.push(question));
      return { rt, toolsUsed, asks };
    },
  };
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms / 1000}s`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function main(): Promise<void> {
  const selected = ONLY ? scenarios.filter((s) => s.name.includes(ONLY)) : scenarios;

  if (LIST) {
    console.log(C.bold("\nE2E scenarios:\n"));
    for (const s of scenarios) console.log(`  ${C.cyan(s.name.padEnd(20))} ${C.dim(s.desc)}`);
    console.log("");
    return;
  }
  if (selected.length === 0) {
    console.error(C.red(`No scenarios match --only "${ONLY}". Use --list to see them.`));
    process.exitCode = 1;
    return;
  }

  const conf = await loadConfig();
  const model = MODEL_OVERRIDE ?? conf.model;
  const registry = await AgentRegistry.create();

  // Preflight: provider + model reachable.
  console.log(C.bold(`\nItsAAgent E2E suite`));
  console.log(`${C.dim("model")}    ${model}`);
  console.log(`${C.dim("host")}     ${conf.host}`);
  console.log(`${C.dim("scratch")}  ${SCRATCH_ROOT}\n`);

  const preflightConf = await toAgentConfig(conf, { agent: "build", model, log: false });
  const preflight = new AgentRuntime(preflightConf);
  const health = await preflight.checkProvider();
  if (!health.ok) {
    console.error(C.red(`✗ Provider not reachable at ${conf.host}. Is Ollama running?`));
    process.exitCode = 1;
    return;
  }
  if (!health.models.some((m) => m.name === model)) {
    console.error(C.red(`✗ Model "${model}" is not available. Pull it or pass --model.`));
    console.error(C.dim(`  Available: ${health.models.map((m) => m.name).join(", ")}`));
    process.exitCode = 1;
    return;
  }

  // Fresh scratch root.
  if (!KEEP) rmSync(SCRATCH_ROOT, { recursive: true, force: true });
  mkdirSync(SCRATCH_ROOT, { recursive: true });

  const results: { name: string; ok: boolean; ms: number; err?: string; attempts: number }[] = [];

  for (const s of selected) {
    process.stdout.write(`${C.cyan("▶")} ${s.name.padEnd(20)} ${C.dim(s.desc)}\n`);
    let ok = false;
    let lastErr = "";
    let attempts = 0;
    const start = Date.now();

    for (let attempt = 1; attempt <= Math.max(1, RETRIES); attempt++) {
      attempts = attempt;
      const dir = join(SCRATCH_ROOT, RETRIES > 1 ? `${s.name}-${attempt}` : s.name);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      process.chdir(dir);
      setSessionCwd(dir);
      try {
        const ctx = await buildCtx(dir, model, registry);
        await withTimeout(s.run(ctx), TIMEOUT_MS, s.name);
        ok = true;
        break;
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
        if (attempt < RETRIES) process.stdout.write(C.yellow(`    retry ${attempt} failed: ${truncate(lastErr, 100)}\n`));
      } finally {
        process.chdir(REPO_ROOT);
      }
    }

    const ms = Date.now() - start;
    results.push({ name: s.name, ok, ms, err: ok ? undefined : lastErr, attempts });
    const tag = ok ? C.green("✓ PASS") : C.red("✗ FAIL");
    process.stdout.write(`  ${tag} ${C.dim(`(${(ms / 1000).toFixed(1)}s${attempts > 1 ? `, ${attempts} attempts` : ""})`)}\n`);
    if (!ok) process.stdout.write(`  ${C.red("└")} ${lastErr}\n`);
    process.stdout.write("\n");
  }

  // Summary
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  const total = (results.reduce((a, r) => a + r.ms, 0) / 1000).toFixed(1);
  console.log(C.bold("─".repeat(48)));
  console.log(
    `${C.bold("Summary")}  ${C.green(`${passed} passed`)}  ${failed ? C.red(`${failed} failed`) : C.dim("0 failed")}  ${C.dim(`(${total}s, model ${model})`)}`,
  );
  if (failed) {
    console.log("");
    for (const r of results.filter((r) => !r.ok)) console.log(`  ${C.red("✗")} ${r.name}: ${r.err}`);
  }
  if (KEEP) console.log(C.dim(`\nScratch kept at ${SCRATCH_ROOT}`));
  console.log("");

  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error(C.red(`\nE2E harness crashed: ${err instanceof Error ? err.stack : String(err)}`));
  process.exitCode = 1;
});
