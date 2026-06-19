# Known issues

Running ItsAAgent against small, locally-hosted models surfaces behaviours
that are worth knowing about. This file tracks them. See also
[TESTED_MODELS.md](./TESTED_MODELS.md) for per-model notes.

---

## KI-1 · Models emit tool calls in inconsistent formats

**What happens:** Even a model that advertises native tool-calling support
(`iaa check` shows "✓ Native tool use supported") does not always use it.
Smaller models (7B) frequently type the tool call into their normal text
output instead of the structured `tool_calls` channel, and they vary the
exact shape — sometimes `<tool_call>{...}</tool_call>`, sometimes bare JSON,
and sometimes the OpenAI-style `"arguments"` key instead of our `"args"`.

**Impact:** If a tool call isn't recognised, the agent treats the response as
a final answer and stops after one step.

**Mitigation (in place):** Tool calling is native-first with a forgiving text
parser as fallback. The parser accepts `<tool_call>` blocks, legacy
`TOOL:` lines, and bare JSON, and recognises both `args` and `arguments`.
This covers the formats observed so far.

**Residual risk:** A model could still invent a format the parser doesn't
recognise. If runs stall after one step, the model's tool-call format is the
first thing to check. Prefer a model with strong native tool support.

---

## KI-2 · 7B models sometimes produce vague final answers

**What happens:** After completing the tool work correctly, a 7B model may
write a hand-wavy summary such as "the output will be shown in the next
response" instead of stating the result.

**Impact:** Cosmetic — the work was done correctly; only the phrasing is poor.

**Mitigation:** None code-side; this is model quality. A larger or more
instruction-tuned model gives crisper answers. Prompt tuning may help and is
a candidate for a future release.

---

## KI-3 · Interactive home menu requires a real terminal

**What happens:** Running `iaa` with no arguments opens the Clack menu only
when stdout is a TTY. When output is piped or run in a non-interactive
environment, it prints the command help instead.

**Impact:** By design — there is no way to drive an arrow-key menu without a
terminal. Use the explicit subcommands (`iaa run`, `iaa chat`, …) in scripts.

---

## KI-4 · scp password auth needs `sshpass`

**What happens:** `ssh_upload` / `ssh_download` use `scp`. Password auth (via
`SSH_PASS`) requires `sshpass` on the host; it is not installed by default on
macOS.

**Impact:** Without `sshpass` and without a key, the transfer fails fast with
a clear message rather than hanging.

**Mitigation:** Use key auth (`key_path`), or `brew install sshpass`.

---

## KI-5 · pnpm global bin must be on PATH

**What happens:** After `pnpm add -g .`, the `iaa` binary lives in pnpm's
global bin dir, which is only added to PATH by `pnpm setup` (a one-time shell
profile change). In an already-open terminal the new PATH isn't active yet.

**Mitigation:** Run `pnpm setup` once, then open a new shell or
`source ~/.zshrc`.
