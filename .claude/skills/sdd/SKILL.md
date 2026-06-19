---
name: sdd
description: Enforce Spec-Driven Development for any non-trivial change in this repo — spec first (with semver versioning), then plan, branch, build to the spec, test, update docs/CHANGELOG/README, merge to main, and tag if it is a release. Trigger when starting a feature, fix, or refactor; when the user says "spec this", "SDD", "new feature/change", or asks to plan or version a change. Skip only for truly trivial one-liners.
---

# Spec-Driven Development (SDD)

This repo ships by spec. Do **not** start coding a non-trivial change until a spec exists and is approved. Follow the steps in order. Each step gates the next.

## When to use
- Any new feature, tool, command, or provider.
- Any behaviour change, refactor, or fix beyond a one-line typo.
- Whenever the user asks to plan, version, or "spec" something.

Skip only for trivial, obviously-correct one-liners — and say so explicitly when you skip.

## Repo conventions (assume these)
- Package manager: **pnpm** (never npm/yarn). Build `pnpm build`, test `pnpm test`.
- **Direct commits to `main` are blocked** by `.githooks/pre-commit`. Always work on a branch and merge.
- Specs live in `spec/vX.Y.Z.md`. Changelog is `CHANGELOG.md` (Keep a Changelog). Versioning is [semver].
- Branch prefixes: `feat/`, `fix/`, `chore/`, `docs/`.

---

## Step 1 — Spec (with versioning)

1. Classify the change and pick the version bump:
   - **patch** `x.y.Z` — bug fixes, no new surface.
   - **minor** `x.Y.0` — new tools/commands/flags/providers, backward-compatible.
   - **major** `X.0.0` — breaking config or CLI changes.
2. Write or extend `spec/vX.Y.Z.md` with:
   - **Vision** (one paragraph) and **Background** (the gaps this closes).
   - **Features**, each with: motivation, behaviour, **acceptance criteria** (checkbox list), and **files changed**.
   - **Implementation order** (dependency-aware) and **Branch strategy**.
   - **Definition of done** (see bottom).
3. Commit the spec on a `docs/vX.Y.Z-spec` branch and **present it for approval**. Do not implement until the user approves. Revise on request.

> One spec can cover several features. Mirror each acceptance criterion 1:1 in a later test.

## Step 2 — Branch

Branch from up-to-date `main`, one branch per feature:
`git checkout main && git pull && git checkout -b feat/<thing>`
Use the prefix matching the work (`feat/`, `fix/`, `chore/`, `docs/`).

## Step 3 — Build to the spec

Implement exactly what the spec says — no scope creep. If reality forces a deviation, update the spec first, then code. Keep commits small and descriptive. Match surrounding code style.

## Step 4 — Test

- `pnpm build` passes with zero errors.
- `pnpm test` passes (all pre-existing + new tests).
- Every acceptance criterion is reflected in a test description.
- Where practical, smoke-test the real binary (`pnpm add -g .` then run `iaa …`).
- Check off the acceptance criteria in the spec as they pass.

## Step 5 — Docs

Update whatever the change touches:
- `CHANGELOG.md` under `[Unreleased]` (Added / Changed / Fixed / Breaking).
- `README.md` (CLI reference, features, examples) if user-facing.
- `CLAUDE.md` if architecture or workflow changed.
- `docs/` (KNOWN_ISSUES, TESTED_MODELS, etc.) where relevant.

## Step 6 — Merge to main

- Confirm build + tests are green on the branch.
- Merge with `--no-ff` for visible provenance:
  `git checkout main && git merge --no-ff <branch> && git branch -d <branch>`
- Never commit directly on `main` (the hook enforces this; merges are allowed).
- Push: `git push origin main`.

## Step 7 — Tag, only if this is a release

When the spec's features are all merged and green:
1. Bump `version` in `package.json` and `src/index.ts` (`.version(...)`) on a `chore/release-vX.Y.Z` branch.
2. Roll `CHANGELOG.md` `[Unreleased]` → `[vX.Y.Z] — <date>` (newest on top).
3. Merge that branch to `main` (`--no-ff`).
4. `git tag -a vX.Y.Z -m "…"` and `git push origin main --follow-tags`.

---

## Definition of done
- [ ] Spec written, versioned, and approved before coding
- [ ] Work done on an appropriately-named branch (never on `main`)
- [ ] All acceptance criteria met and checked off in the spec
- [ ] `pnpm build` and `pnpm test` green; criteria reflected 1:1 in tests
- [ ] CHANGELOG / README / CLAUDE.md / docs updated as needed
- [ ] Merged to `main` with `--no-ff`; branch deleted
- [ ] Tagged + pushed if a release
- [ ] No `console.log` left in production paths
