/**
 * End-to-end functional test harness for ItsAAgent.
 *
 * Unlike the Vitest unit suite (`pnpm test`), this drives the *real* agent
 * runtime against a *live* Ollama model and asserts on real effects — files
 * created/edited/deleted on disk, searches that actually find things, context
 * remembered across turns, a plan handed from the `plan` agent to the `build`
 * agent (both at the runtime level and through the TUI's capture path), and
 * gated coverage of network/SSH/parser-fallback paths.
 *
 *   pnpm e2e                        # run every scenario once on the configured model
 *   pnpm e2e -- --runs 3            # run each scenario 3× and report a pass-rate (reliability)
 *   pnpm e2e -- --only handoff      # run scenarios whose name contains "handoff"
 *   pnpm e2e -- --model mistral:7b  # override the model
 *   pnpm e2e -- --list              # list scenarios without running
 *   pnpm e2e -- --timeout 300       # per-run timeout in seconds (default 240)
 *   pnpm e2e -- --keep              # keep the scratch dir for inspection
 *
 * Results are always written to tests/e2e/results/ as both JSON (machine) and
 * Markdown (human review), and the paths are printed at the end.
 *
 * Gated scenarios skip (not fail) when their precondition is absent:
 *   - ssh-roundtrip   needs IAA_E2E_SSH_HOST (and optionally IAA_E2E_SSH_USER)
 *   - fetch-url       needs outbound network
 *   - parser-fallback needs a non-tool-capable model installed
 *
 * Each scenario runs in its own clean temp dir, with both the process cwd and
 * the shared session cwd pointed at it, so nothing ever touches the real home.
 */
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import os from "node:os";

import { AgentRuntime } from "../../src/agent/AgentRuntime.js";
import { AgentRegistry } from "../../src/agent/AgentRegistry.js";
import type { AgentDefinition } from "../../src/agent/AgentDefinition.js";
import { loadConfig, toAgentConfig } from "../../src/cli/config.js";
import { setSessionCwd } from "../../src/tools/session.js";
import { conversationReducer, initialConversation, lastAnswer } from "../../src/cli/tui/state/conversation.js";

// ---------------------------------------------------------------------------
// ANSI helpers (no dependencies)
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
const flag = (name: string): boolean => argv.includes(`--${name}`);
function opt(name: string, fallback?: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
}

const ONLY = opt("only");
const MODEL_OVERRIDE = opt("model");
const RUNS = Math.max(1, Number(opt("runs", "1")));
const TIMEOUT_MS = Number(opt("timeout", "240")) * 1000;
const KEEP = flag("keep");
const LIST = flag("list");

const REPO_ROOT = process.cwd();
const SCRATCH_ROOT = join(os.tmpdir(), "iaa-e2e");
const RESULTS_DIR = join(REPO_ROOT, "tests", "e2e", "results");

// ---------------------------------------------------------------------------
// Assertions / skip
// ---------------------------------------------------------------------------
class AssertionError extends Error {}
class SkipError extends Error {}
function fail(msg: string): never {
  throw new AssertionError(msg);
}
function skip(reason: string): never {
  throw new SkipError(reason);
}

function read(dir: string, rel: string): string {
  return readFileSync(join(dir, rel), "utf-8");
}
function fileExists(dir: string, rel: string): void {
  if (!existsSync(join(dir, rel))) fail(`expected file to exist: ${rel}`);
}
function fileAbsent(dir: string, rel: string): void {
  if (existsSync(join(dir, rel))) fail(`expected file to be gone: ${rel}`);
}
function dirExists(dir: string, rel: string): void {
  const p = join(dir, rel);
  if (!existsSync(p) || !statSync(p).isDirectory()) fail(`expected directory to exist: ${rel}`);
}
function fileContains(dir: string, rel: string, needle: string): void {
  fileExists(dir, rel);
  if (!read(dir, rel).toLowerCase().includes(needle.toLowerCase())) fail(`file ${rel} should contain "${needle}"`);
}
function fileLacks(dir: string, rel: string, needle: string): void {
  fileExists(dir, rel);
  if (read(dir, rel).toLowerCase().includes(needle.toLowerCase())) fail(`file ${rel} should no longer contain "${needle}"`);
}
function contains(haystack: string, needle: string, label = "output"): void {
  if (!haystack.toLowerCase().includes(needle.toLowerCase())) fail(`${label} should contain "${needle}" — got: ${truncate(haystack, 200)}`);
}
function notContains(haystack: string, needle: string, label = "output"): void {
  if (haystack.toLowerCase().includes(needle.toLowerCase())) fail(`${label} should NOT contain "${needle}" — got: ${truncate(haystack, 200)}`);
}
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
interface RuntimeBundle {
  rt: AgentRuntime;
  toolsUsed: string[];
  asks: string[];
}
interface Ctx {
  dir: string;
  env: NodeJS.ProcessEnv;
  runtime(agentId: string, modelOverride?: string): Promise<RuntimeBundle>;
  agent(id: string): AgentDefinition;
}
interface Scenario {
  name: string;
  desc: string;
  run(ctx: Ctx): Promise<void>;
}
const scenarios: Scenario[] = [];
function scenario(name: string, desc: string, run: (ctx: Ctx) => Promise<void>): void {
  scenarios.push({ name, desc, run });
}

// 1. Plain conversation — answer directly, no tool.
scenario("simple-chat", "Answers a conversational prompt without using a tool", async (ctx) => {
  const { rt, toolsUsed } = await ctx.runtime("build");
  const answer = await rt.run("Reply with exactly the single word: PONG. No punctuation, no explanation.");
  contains(answer, "pong");
  if (toolsUsed.length > 0) fail(`should not have called any tool, used: ${toolsUsed.join(", ")}`);
});

// 2. Shell command via bash.
scenario("shell-command", "Runs a shell command and reports the result", async (ctx) => {
  writeFileSync(join(ctx.dir, "a.txt"), "x");
  writeFileSync(join(ctx.dir, "b.txt"), "y");
  const { rt, toolsUsed } = await ctx.runtime("build");
  const answer = await rt.run("Using a shell command, count how many files are in the current directory and tell me the number.");
  if (!toolsUsed.includes("bash")) fail(`expected the bash tool, used: ${toolsUsed.join(", ") || "none"}`);
  contains(answer, "2");
});

// 3. File creation.
scenario("file-creation", "Creates a file with the requested content", async (ctx) => {
  const { rt } = await ctx.runtime("build");
  await rt.run("Create a file named hello.txt in the current directory containing exactly: hello world");
  fileContains(ctx.dir, "hello.txt", "hello world");
});

// 4. Folder + nested file.
scenario("folder-creation", "Creates a directory with a file inside it", async (ctx) => {
  const { rt } = await ctx.runtime("build");
  await rt.run("Create a directory named project, and inside it a file named notes.txt containing exactly: inside the folder");
  dirExists(ctx.dir, "project");
  fileContains(ctx.dir, "project/notes.txt", "inside the folder");
});

// 5. Edit an existing file. edit_file is line-based, so the agent must read
//    the file first to locate the line — which is the realistic usage.
scenario("edit-file", "Edits an existing file's content", async (ctx) => {
  writeFileSync(join(ctx.dir, "config.txt"), "host=localhost\nport=8080\ndebug=false\n");
  const { rt } = await ctx.runtime("build");
  await rt.run("First read config.txt to see its exact lines, then change the port value from 8080 to 9090, leaving every other line unchanged.");
  fileContains(ctx.dir, "config.txt", "9090");
  fileLacks(ctx.dir, "config.txt", "8080");
  fileContains(ctx.dir, "config.txt", "host=localhost"); // other lines preserved
});

// 6. Append to a file.
scenario("append-file", "Appends to an existing file without losing content", async (ctx) => {
  writeFileSync(join(ctx.dir, "log.txt"), "first line\n");
  const { rt } = await ctx.runtime("build");
  await rt.run('Append a new line containing exactly "second line" to the file log.txt. Keep the existing content.');
  fileContains(ctx.dir, "log.txt", "first line");
  fileContains(ctx.dir, "log.txt", "second line");
});

// 7. Delete a file.
scenario("delete-file", "Deletes the requested file", async (ctx) => {
  writeFileSync(join(ctx.dir, "junk.txt"), "delete me");
  writeFileSync(join(ctx.dir, "keep.txt"), "keep me");
  const { rt } = await ctx.runtime("build");
  await rt.run("Delete the file junk.txt from the current directory. Do not touch any other file.");
  fileAbsent(ctx.dir, "junk.txt");
  fileExists(ctx.dir, "keep.txt");
});

// 8. Glob — find files by pattern.
scenario("glob-search", "Finds files by glob pattern", async (ctx) => {
  writeFileSync(join(ctx.dir, "alpha.txt"), "a");
  writeFileSync(join(ctx.dir, "beta.txt"), "b");
  writeFileSync(join(ctx.dir, "notes.md"), "m");
  const { rt } = await ctx.runtime("build");
  const answer = await rt.run("List the names of all files ending in .txt in the current directory.");
  contains(answer, "alpha.txt");
  contains(answer, "beta.txt");
});

// 9. Grep — find content across files.
scenario("grep-search", "Finds which file contains a string", async (ctx) => {
  writeFileSync(join(ctx.dir, "one.txt"), "nothing here\n");
  writeFileSync(join(ctx.dir, "two.txt"), "this line has the marker ZEBRA42 in it\n");
  writeFileSync(join(ctx.dir, "three.txt"), "also nothing\n");
  const { rt } = await ctx.runtime("build");
  const answer = await rt.run("Search the files in the current directory and tell me which filename contains the text ZEBRA42.");
  contains(answer, "two.txt");
});

// 10. Git — stage and commit via the git tool.
scenario("git-commit", "Stages and commits a file with the git tool", async (ctx) => {
  execFileSync("git", ["init", "-q"], { cwd: ctx.dir });
  execFileSync("git", ["config", "user.email", "e2e@test.local"], { cwd: ctx.dir });
  execFileSync("git", ["config", "user.name", "E2E"], { cwd: ctx.dir });
  writeFileSync(join(ctx.dir, "readme.txt"), "hello repo\n");
  const { rt, toolsUsed } = await ctx.runtime("build");
  await rt.run('Stage all changes and create a git commit with the message "initial commit".');
  if (!toolsUsed.includes("git") && !toolsUsed.includes("bash")) fail(`expected git/bash, used: ${toolsUsed.join(", ") || "none"}`);
  const log = execFileSync("git", ["log", "--oneline"], { cwd: ctx.dir, encoding: "utf-8" });
  if (!log.toLowerCase().includes("initial commit")) fail(`expected a commit named "initial commit", git log: ${truncate(log, 120)}`);
});

// 11. Context memory WITHIN a run — uses an earlier tool result to answer.
scenario("context-memory", "Uses an earlier tool result later in the same run", async (ctx) => {
  writeFileSync(join(ctx.dir, "secret.txt"), "The access code is 4271.\n");
  const { rt, toolsUsed } = await ctx.runtime("build");
  const answer = await rt.run("Read the file secret.txt and tell me the access code it contains.");
  if (!toolsUsed.includes("read_file") && !toolsUsed.includes("bash")) fail(`expected a read, used: ${toolsUsed.join(", ") || "none"}`);
  contains(answer, "4271");
});

// 12. Chat memory ACROSS turns.
scenario("chat-memory", "Remembers facts across chat turns (continueChat)", async (ctx) => {
  const { rt } = await ctx.runtime("build");
  rt.initSession();
  await rt.continueChat("My name is Ada and my favourite number is 7. Please remember both.");
  const answer = await rt.continueChat("What is my name, and what is my favourite number?");
  contains(answer, "ada");
  contains(answer, "7");
});

// 13. Session isolation — STRUCTURAL (no shared context) + behavioural.
scenario("session-isolation", "A separate session shares no context with another", async (ctx) => {
  const SECRET = "zphmqx7"; // a token the model would never emit by chance
  const a = await ctx.runtime("build");
  a.rt.initSession();
  await a.rt.continueChat(`Remember this codeword: ${SECRET}. Acknowledge only.`);

  // Brand-new runtime = brand-new Session/ContextManager.
  const b = await ctx.runtime("build");
  // Structural proof: B's context literally contains no trace of A's secret.
  const bContext = b.rt.session.ctx.get().map((m) => m.content).join("\n");
  notContains(bContext, SECRET, "fresh session context");
  // Behavioural: B cannot produce the secret it never saw.
  const answer = await b.rt.run("If I gave you a codeword earlier in this conversation, repeat it. If not, reply exactly: NONE.");
  notContains(answer, SECRET, "fresh session answer");
});

// 14. Plan agent is read-only.
scenario("plan-readonly", "Plan agent produces a plan and creates no files", async (ctx) => {
  const { rt, toolsUsed } = await ctx.runtime("plan");
  const answer = await rt.run("Plan (do not build) how to create a Node script app.js that prints hello. Give numbered steps.");
  for (const t of ["write_file", "edit_file", "append_file", "delete_file", "bash"]) {
    if (toolsUsed.includes(t)) fail(`plan agent must not call ${t} (used: ${toolsUsed.join(", ")})`);
  }
  const files = listFiles(ctx.dir);
  if (files.length > 0) fail(`plan agent should create no files, found: ${files.join(", ")}`);
  if (answer.trim().length < 30) fail(`expected a substantive plan, got: ${truncate(answer, 120)}`);
});

// 15. Runtime-level handoff: plan an Express API, build it.
scenario("handoff-express", "Plan → build handoff builds the Express API (runtime path)", async (ctx) => {
  const b = await ctx.runtime("plan");
  const plan = await b.rt.run(
    "Plan a minimal Express API in the current directory: a package.json declaring express as a dependency, and an " +
      "index.js that starts an Express server on port 3000 with a GET / route returning 'hello'. Do NOT run npm install. " +
      "Output concrete, numbered steps with the file contents.",
  );
  if (plan.trim().length < 30) fail(`plan stage produced no usable plan: ${truncate(plan, 120)}`);
  await b.rt.handoffToBuild(ctx.agent("build"), plan);
  if (!b.rt.session.transitions.some((t) => t.from === "plan" && t.to === "build")) fail("expected a plan → build transition");
  fileContains(ctx.dir, "package.json", "express");
  const jsFiles = listFiles(ctx.dir).filter((f) => f.endsWith(".js"));
  if (jsFiles.length === 0) fail(`expected a server .js file, found: ${listFiles(ctx.dir).join(", ") || "nothing"}`);
  const server = jsFiles.map((f) => read(ctx.dir, f).toLowerCase()).join("\n");
  if (!server.includes("express")) fail("server file should use express");
  if (!server.includes("listen")) fail("server file should call .listen()");
});

// 16. TUI capture path: drive the conversation reducer + lastAnswer exactly as
//     the TUI does when you press Tab, then hand the captured plan to build.
scenario("guided-tui-handoff", "Plan → build via the TUI's capture path (reducer + lastAnswer)", async (ctx) => {
  const b = await ctx.runtime("plan");
  let conv = initialConversation();
  // Mirror useAgentEvents: the runtime's answer becomes an entry in the transcript.
  b.rt.on("answer", ({ text }) => {
    conv = conversationReducer(conv, { type: "answer", text });
  });
  conv = conversationReducer(conv, { type: "user", text: "plan it" });
  await b.rt.run(
    "Plan the creation of a single file named greet.js in the current directory whose exact content is: " +
      "console.log('hello from build'); — include that exact file content in your numbered plan. " +
      "Do not create or run the file yourself; just produce the plan.",
  );

  // This is the exact line the TUI runs on Tab:
  const captured = lastAnswer(conv.entries);
  if (!captured.trim()) fail("TUI capture (lastAnswer) returned an empty plan");

  await b.rt.handoffToBuild(ctx.agent("build"), captured);
  if (!b.rt.session.transitions.some((t) => t.from === "plan" && t.to === "build")) fail("expected a plan → build transition");
  fileExists(ctx.dir, "greet.js");
  fileContains(ctx.dir, "greet.js", "hello from build");
});

// 17. ask_user clarification.
scenario("ask-user", "Asks the user for missing info and uses the answer", async (ctx) => {
  const { rt, toolsUsed, asks } = await ctx.runtime("build");
  rt.setAskUserHandler(async () => "greeting.txt");
  await rt.run(
    "Create a text file in the current directory containing exactly: hi there. You do not know the filename — you MUST " +
      "call ask_user to ask me for the filename before creating it.",
  );
  fileContains(ctx.dir, "greeting.txt", "hi there");
  if (!toolsUsed.includes("ask_user") && asks.length === 0) fail("expected the agent to call ask_user for the filename");
});

// 18. Build agent completes a multi-step task in ONE run (no staggered stops).
scenario("build-full-api", "Build agent codes a full Express API in one run", async (ctx) => {
  const { rt } = await ctx.runtime("build");
  await rt.run(
    "Set up an Express API in the current directory: create a package.json declaring express as a dependency and a " +
      "complete index.js with a server and a GET /hello endpoint that returns 'hello world'. Do not run npm install.",
  );
  // package.json with express, and a non-empty server that defines BOTH the
  // server and the route — i.e. it didn't just `touch` an empty file or stop early.
  fileContains(ctx.dir, "package.json", "express");
  const jsFiles = listFiles(ctx.dir).filter((f) => f.endsWith(".js"));
  if (jsFiles.length === 0) fail(`expected a server .js file, found: ${listFiles(ctx.dir).join(", ") || "nothing"}`);
  const server = jsFiles.map((f) => read(ctx.dir, f)).join("\n");
  if (server.trim().length < 40) fail(`server file is basically empty (staggered/incomplete build): ${truncate(server, 80)}`);
  const lc = server.toLowerCase();
  if (!lc.includes("express")) fail("server should use express");
  if (!lc.includes("listen")) fail("server should call .listen()");
  if (!lc.includes("/hello")) fail("server should define the /hello route");
});

// 19. Completeness generalises beyond web APIs — a CLI script with edge cases,
//     built fully in one run (proves the build agent isn't express-specific).
scenario("build-complete-script", "Build agent ships a complete CLI script in one run", async (ctx) => {
  const { rt } = await ctx.runtime("build");
  await rt.run(
    "Create a complete Node.js script named greet.js that reads a name from the first command-line argument and prints " +
      "'Hello, <name>!'. If no name is given, print a usage message instead. Write the full working script. Do not run it.",
  );
  fileExists(ctx.dir, "greet.js");
  const src = read(ctx.dir, "greet.js");
  if (src.trim().length < 40) fail(`greet.js is basically empty (incomplete build): ${truncate(src, 80)}`);
  const lc = src.toLowerCase();
  if (!lc.includes("argv")) fail("script should read a command-line argument (process.argv)");
  if (!lc.includes("hello")) fail("script should print the greeting");
  // The edge case was handled too — not just the happy path / first win.
  if (!/usage/i.test(src)) fail("script should handle the no-argument case with a usage message");
});

// 20. fetch — GATED on network.
scenario("fetch-url", "Fetches a URL and reports its content (needs network)", async (ctx) => {
  let online = false;
  try {
    execFileSync("curl", ["-sf", "-o", "/dev/null", "--max-time", "5", "https://example.com"]);
    online = true;
  } catch {
    online = false;
  }
  if (!online) skip("no outbound network (could not reach example.com)");
  const { rt, toolsUsed } = await ctx.runtime("build");
  const answer = await rt.run(
    "Use the fetch tool to GET the URL https://example.com (do not use grep or any search tool), then tell me a word that appears on the page.",
  );
  if (!toolsUsed.includes("fetch") && !toolsUsed.includes("bash")) fail(`expected fetch/bash, used: ${toolsUsed.join(", ") || "none"}`);
  contains(answer, "example");
});

// 21. ssh — GATED on IAA_E2E_SSH_HOST (or a reachable localhost sshd).
scenario("ssh-roundtrip", "Runs a command on a host over SSH (needs IAA_E2E_SSH_HOST)", async (ctx) => {
  const host = ctx.env.IAA_E2E_SSH_HOST;
  const user = ctx.env.IAA_E2E_SSH_USER ?? os.userInfo().username;
  if (!host) skip("set IAA_E2E_SSH_HOST (and optionally IAA_E2E_SSH_USER) to run this");
  try {
    execFileSync("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", `${user}@${host}`, "true"]);
  } catch {
    skip(`SSH to ${user}@${host} is not reachable with key auth`);
  }
  const { rt, toolsUsed } = await ctx.runtime("build");
  const answer = await rt.run(`Using SSH, connect to host ${host} as user ${user} and run the command: echo SSHWORKS. Report the output.`);
  if (!toolsUsed.includes("ssh")) fail(`expected the ssh tool, used: ${toolsUsed.join(", ") || "none"}`);
  contains(answer, "sshworks");
});

// NOTE: the text-parser fallback (no native tool_calls → parse <tool_call>
// text → execute it) is covered deterministically in the unit suite
// (tests/agent/parserFallback.test.ts) with a scripted provider, rather than
// here, where it would depend on the competence of an arbitrary non-tool
// model and produce noisy false failures.

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
type Status = "pass" | "fail" | "flaky" | "skip";
interface RunResult {
  ok: boolean;
  ms: number;
  err?: string;
}
interface ScenarioResult {
  name: string;
  desc: string;
  status: Status;
  skipReason?: string;
  runs: RunResult[];
  passRate: string;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
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

async function buildCtx(dir: string, model: string, registry: AgentRegistry): Promise<Ctx> {
  return {
    dir,
    env: process.env,
    agent(id: string): AgentDefinition {
      const def = registry.get(id);
      if (!def) throw new Error(`unknown agent: ${id}`);
      return def;
    },
    async runtime(agentId: string, modelOverride?: string): Promise<RuntimeBundle> {
      const conf = await loadConfig();
      const agentConfig = await toAgentConfig(conf, { agent: agentId, model: modelOverride ?? model, log: false });
      const rt = new AgentRuntime(agentConfig);
      const toolsUsed: string[] = [];
      const asks: string[] = [];
      rt.on("tool:call", ({ name }) => toolsUsed.push(name));
      rt.on("ask", ({ question }) => asks.push(question));
      return { rt, toolsUsed, asks };
    },
  };
}

function ts(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function writeResults(payload: {
  startedAt: string;
  finishedAt: string;
  model: string;
  host: string;
  runsPerScenario: number;
  durationMs: number;
  results: ScenarioResult[];
}): { json: string; md: string } {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const stamp = ts(new Date(payload.finishedAt));
  const jsonPath = join(RESULTS_DIR, `e2e-${stamp}.json`);
  const mdPath = join(RESULTS_DIR, `e2e-${stamp}.md`);

  const counts = {
    pass: payload.results.filter((r) => r.status === "pass").length,
    flaky: payload.results.filter((r) => r.status === "flaky").length,
    fail: payload.results.filter((r) => r.status === "fail").length,
    skip: payload.results.filter((r) => r.status === "skip").length,
  };
  writeFileSync(jsonPath, JSON.stringify({ ...payload, summary: counts }, null, 2));

  const icon = (s: Status): string => (s === "pass" ? "✅" : s === "flaky" ? "⚠️" : s === "fail" ? "❌" : "⏭️");
  const lines: string[] = [];
  lines.push(`# ItsAAgent E2E results`);
  lines.push("");
  lines.push(`- **Model:** \`${payload.model}\``);
  lines.push(`- **Host:** ${payload.host}`);
  lines.push(`- **Started:** ${payload.startedAt}`);
  lines.push(`- **Finished:** ${payload.finishedAt}`);
  lines.push(`- **Runs per scenario:** ${payload.runsPerScenario}`);
  lines.push(`- **Duration:** ${(payload.durationMs / 1000).toFixed(1)}s`);
  lines.push("");
  lines.push(`**Summary:** ${counts.pass} passed · ${counts.flaky} flaky · ${counts.fail} failed · ${counts.skip} skipped (of ${payload.results.length})`);
  lines.push("");
  lines.push(`| | Scenario | Status | Pass rate | Avg time | Notes |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const r of payload.results) {
    const done = r.runs.filter((x) => x.ms > 0);
    const avg = done.length ? (done.reduce((a, x) => a + x.ms, 0) / done.length / 1000).toFixed(1) + "s" : "—";
    const note = r.status === "skip" ? r.skipReason ?? "" : r.runs.find((x) => !x.ok)?.err ?? "";
    lines.push(`| ${icon(r.status)} | \`${r.name}\` | ${r.status} | ${r.passRate} | ${avg} | ${truncate(note, 120).replace(/\|/g, "/")} |`);
  }
  lines.push("");
  lines.push(`> ${payload.results.length} scenarios. Generated by \`pnpm e2e\`.`);
  lines.push("");
  lines.push(`## Scenario details`);
  lines.push("");
  for (const r of payload.results) {
    lines.push(`### ${icon(r.status)} ${r.name} — ${r.status}`);
    lines.push(`${r.desc}`);
    if (r.status === "skip") {
      lines.push(`- Skipped: ${r.skipReason}`);
    } else {
      r.runs.forEach((run, i) => {
        const head = `- Run ${i + 1}: ${run.ok ? "pass" : "fail"} (${(run.ms / 1000).toFixed(1)}s)`;
        lines.push(run.ok ? head : `${head} — ${run.err}`);
      });
    }
    lines.push("");
  }
  writeFileSync(mdPath, lines.join("\n"));
  return { json: jsonPath, md: mdPath };
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

  console.log(C.bold(`\nItsAAgent E2E suite`));
  console.log(`${C.dim("model")}    ${model}`);
  console.log(`${C.dim("host")}     ${conf.host}`);
  console.log(`${C.dim("runs")}     ${RUNS} per scenario`);
  console.log(`${C.dim("scratch")}  ${SCRATCH_ROOT}\n`);

  // Preflight: provider + model reachable.
  const preflight = new AgentRuntime(await toAgentConfig(conf, { agent: "build", model, log: false }));
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

  if (!KEEP) rmSync(SCRATCH_ROOT, { recursive: true, force: true });
  mkdirSync(SCRATCH_ROOT, { recursive: true });

  const startedAt = new Date().toISOString();
  const suiteStart = Date.now();
  const results: ScenarioResult[] = [];

  for (const s of selected) {
    process.stdout.write(`${C.cyan("▶")} ${s.name.padEnd(20)} ${C.dim(s.desc)}\n`);
    const runs: RunResult[] = [];
    let skipReason: string | undefined;

    // At --runs 1 we retry once on failure so a single model flake reports as
    // "flaky" rather than a hard fail; a genuinely-broken capability fails both
    // attempts and goes red. At --runs N (N>1) we run exactly N times for a true
    // pass-rate, with no extra retry.
    const maxAttempts = RUNS === 1 ? 2 : RUNS;
    const stopOnFirstPass = RUNS === 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const suffix = RUNS > 1 ? `-${attempt}` : attempt > 1 ? "-retry" : "";
      const dir = join(SCRATCH_ROOT, `${s.name}${suffix}`);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      process.chdir(dir);
      setSessionCwd(dir);
      const start = Date.now();
      try {
        const ctx = await buildCtx(dir, model, registry);
        await withTimeout(s.run(ctx), TIMEOUT_MS);
        runs.push({ ok: true, ms: Date.now() - start });
      } catch (err) {
        if (err instanceof SkipError) {
          skipReason = err.message;
          break;
        }
        runs.push({ ok: false, ms: Date.now() - start, err: err instanceof Error ? err.message : String(err) });
      } finally {
        process.chdir(REPO_ROOT);
      }
      const last = runs[runs.length - 1];
      if (RUNS > 1) {
        process.stdout.write(`    ${last.ok ? C.green(`run ${attempt} ✓`) : C.red(`run ${attempt} ✗ ${truncate(last.err ?? "", 80)}`)}\n`);
      } else if (attempt > 1) {
        process.stdout.write(`    ${C.yellow(`retried after a flake → ${last.ok ? "passed" : "failed again"}`)}\n`);
      }
      if (stopOnFirstPass && last.ok) break;
    }

    let status: Status;
    let passRate: string;
    if (skipReason) {
      status = "skip";
      passRate = "—";
    } else {
      const passes = runs.filter((r) => r.ok).length;
      passRate = `${passes}/${runs.length}`;
      status = passes === runs.length ? "pass" : passes === 0 ? "fail" : "flaky";
    }
    results.push({ name: s.name, desc: s.desc, status, skipReason, runs, passRate });

    const tag =
      status === "pass" ? C.green("✓ PASS") : status === "flaky" ? C.yellow("~ FLAKY") : status === "skip" ? C.dim("⏭ SKIP") : C.red("✗ FAIL");
    const ms = runs.reduce((a, r) => a + r.ms, 0);
    process.stdout.write(`  ${tag} ${C.dim(`${passRate !== "—" ? passRate + "  " : ""}(${(ms / 1000).toFixed(1)}s)`)}\n`);
    if (status === "skip") process.stdout.write(`  ${C.dim("└ " + skipReason)}\n`);
    else if (status !== "pass") process.stdout.write(`  ${C.red("└ " + (runs.find((r) => !r.ok)?.err ?? ""))}\n`);
    process.stdout.write("\n");
  }

  const durationMs = Date.now() - suiteStart;
  const finishedAt = new Date().toISOString();
  const paths = writeResults({ startedAt, finishedAt, model, host: conf.host, runsPerScenario: RUNS, durationMs, results });

  // Summary
  const pass = results.filter((r) => r.status === "pass").length;
  const flaky = results.filter((r) => r.status === "flaky").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skip").length;
  console.log(C.bold("─".repeat(56)));
  console.log(
    `${C.bold("Summary")}  ${C.green(`${pass} passed`)}  ${flaky ? C.yellow(`${flaky} flaky`) : C.dim("0 flaky")}  ${failed ? C.red(`${failed} failed`) : C.dim("0 failed")}  ${C.dim(`${skipped} skipped`)}  ${C.dim(`(${(durationMs / 1000).toFixed(1)}s)`)}`,
  );
  if (failed || flaky) {
    console.log("");
    for (const r of results.filter((r) => r.status === "fail" || r.status === "flaky")) {
      console.log(`  ${r.status === "fail" ? C.red("✗") : C.yellow("~")} ${r.name} (${r.passRate}): ${r.runs.find((x) => !x.ok)?.err ?? ""}`);
    }
  }
  console.log("");
  console.log(`${C.dim("results")}  ${paths.md}`);
  console.log(`${C.dim("       ")}  ${paths.json}`);
  if (KEEP) console.log(C.dim(`scratch  ${SCRATCH_ROOT}`));
  console.log("");

  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error(C.red(`\nE2E harness crashed: ${err instanceof Error ? err.stack : String(err)}`));
  process.exitCode = 1;
});
