# Assignment Brief: skillsgate-o7ni - Give the mirrored core-sync engine a test suite

- **Bean ID**: skillsgate-o7ni
- **Target Branch/Worktree**: fleet/agy-coder-2
- **Base Commit**: 0df626d
- **Dispatched To**: agy-coder-2 (agy)
- **Complexity**: M
- **Cost tier**: coder
- **Critical**: no

## 1. Objective

`apps/desktop/src/main/core-skills.ts` is an ~888-line mirror of
`packages/cli/src/core/core-skills.ts` with **no test file at all**, while the
CLI original has ~403 lines of tests. Every fix can land on one side only and
nothing notices. Port the applicable CLI tests to the mirror.

## 2. Context & Evidence

- Primary files to inspect:
  - `apps/desktop/src/main/core-skills.ts` — the mirror. Note it **injects** the
    agent list as an argument (`planCoreSync(agents)`) instead of calling
    `detectInstalledAgents()`, which is exactly what makes it testable without
    `ipc-handlers.ts`.
  - `packages/cli/src/core/core-skills.test.ts` — the source suite to port:
    remove semantics (`:71-168`), fan-out links + the symlinked-ancestor
    regression (`:170-195`), `installDirToCore` (`:197-301`),
    `findDanglingCoreEntries` (`:372-385`).
  - `apps/desktop/src/main/skill-paths.ts` — the mirrored path constants; the
    test's fake `HOME` must satisfy these, not the CLI's.
- Reference documentation:
  - `docs/adr/0004-share-logic-mirror-stable-config.md` — Negative consequences
    records exactly this gap.
  - `docs/adr/0001-two-tier-skill-store-and-core-fan-out.md`.
- **Deliberate divergence you must pin, not "fix"**: CLI `installDirToCore`
  defaults to `mode ?? "link"` while the desktop mirror defaults to
  `mode ?? "copy"`, because the core dir is git-tracked and the desktop path
  needs real files. Assert both defaults explicitly.

## 3. Strict Rules & Guardrails

- **DO NOT PUSH**: never run `git push`. Commit locally to `fleet/agy-coder-2`.
- **Atomic Commits**: small commits with semantic prefixes.
- **Verification**: whatever test script you add must be runnable and green.
  There is currently **no `test` script in `apps/desktop/package.json`** — adding
  one is in scope and expected. It must not require launching Electron.
  Suggested: `"test": "tsx --test 'src/main/*.test.ts'"`, mirroring the CLI's.
- **Native modules**: do not `require("better-sqlite3")` from a test. The
  core-skills module does not need it; keep the suite hermetic with a fake `HOME`.
- **TDD at seams**: port one test group at a time, run, commit.
- **Report**: `.herdr/reports/skillsgate-o7ni-agy-coder-2.md` ending with
  `## Lessons Learned` (1-3 bullets).
- **Heartbeat** every 5 minutes and after every commit:
  ```bash
  .herdr/scripts/fleet-heartbeat agy-coder-2 skillsgate-o7ni <pct> "<one-line progress>"
  ```
- **Checkpoint** after each sub-step:
  ```bash
  .herdr/scripts/fleet-checkpoint agy-coder-2 skillsgate-o7ni --done "step1" --next "step2"
  ```
- **Quota**: on 429/401/insufficient_quota, stop and announce BLOCKED.
- **Economy**: batch shell commands with `&&`; single heredoc per file write;
  never run `--help`.
- **Frozen contract**: on high-stakes ambiguity, BLOCKED with 2-3 options.

## 4. Acceptance Criteria (numbered, pass/fail)

1. `apps/desktop/src/main/core-skills.test.ts` exists and exercises fan-out
   links, remove/detach/purge semantics, and `installDirToCore`.
2. The test asserts the desktop default mode is `copy` **and** documents that
   the CLI default is `link` — the divergence is pinned, not erased.
3. A `test` script exists in `apps/desktop/package.json` and runs the new suite
   without launching Electron; it exits 0.
4. The suite fails if `apps/desktop/src/main/core-skills.ts` diverges from an
   invariant the CLI suite enforces (at minimum: unlink only when the target
   resolves inside the core dir).
5. `cd packages/cli && bun run test` still exits 0 (you did not break the CLI).

## 4b. Scope (machine-checked)

- allow: `apps/desktop/src/main/core-skills.test.ts`
- allow: `apps/desktop/src/main/core-skills.ts`
- allow: `apps/desktop/package.json`

## 5. Out of Scope

- Unifying the mirror into a shared package (that would be a new bean, see
  `docs/adr/0004-share-logic-mirror-stable-config.md` Risks).
- Editing the CLI suite — it is the reference, not the target.

## 6. Do Not Touch

- `packages/cli/**` — the CLI implementation and its tests are the reference.
- `apps/desktop/src/main/ipc-handlers.ts`.
- `apps/desktop/src/main/db/**` (bean skillsgate-1w5u holds that path).

## 7. Completion Command (Mandatory)

If finished successfully:
```bash
./.herdr/scripts/fleet-done agy-coder-2 skillsgate-o7ni DONE "Ported the core-sync engine test suite to the desktop mirror and pinned its copy-mode divergence" .herdr/reports/skillsgate-o7ni-agy-coder-2.md
```

If blocked:
```bash
./.herdr/scripts/fleet-done agy-coder-2 skillsgate-o7ni BLOCKED "<one-line blocker>" .herdr/reports/skillsgate-o7ni-agy-coder-2.md
```
