# Assignment Brief: skillsgate-0m19 - Cover the whole-directory-symlink false-conflict guard

- **Bean ID**: skillsgate-0m19
- **Target Branch/Worktree**: fleet/agy-coder-1
- **Base Commit**: 0df626d
- **Dispatched To**: agy-coder-1 (agy)
- **Complexity**: S
- **Cost tier**: coder
- **Critical**: no

## 1. Objective

Give the false-conflict guard in `planCoreSync` a regression test. The guard
short-circuits an agent whose `globalSkillsDir` resolves to the core directory;
today it rests on a comment and one observed run, with no test that would fail
if someone removed it.

## 2. Context & Evidence

- Primary file to inspect:
  - `packages/cli/src/core/core-skills.ts` — the guard is the
    `if ((await realpathOrResolve(dir)) === coreRealDir)` block at line 289; it
    pushes every core entry as `action: "skip-present"` with reason
    `"工具目录即 core 目录"`.
  - `packages/cli/src/core/core-skills.test.ts` — existing suite; note the
    module-level fake `HOME` set at lines 7-21 **before** any import, because
    the registry resolves `os.homedir()` at load time. Copy that pattern.
- Reference documentation:
  - `docs/adr/0001-two-tier-skill-store-and-core-fan-out.md` — Risk section
    explicitly records this test as missing.
  - `docs/adr/0002-path-identity-via-realpath.md` — why identity is resolved.
- Why it matters: five agents (Antigravity, CodeBuddy, CodeBuddy CN, Pi,
  WorkBuddy AI) symlink their whole skills dir at the core dir. Without the
  guard all 152 core entries are misreported as same-name conflicts.

## 3. Strict Rules & Guardrails

- **DO NOT PUSH**: never run `git push`. Commit locally to `fleet/agy-coder-1`.
- **Atomic Commits**: small commits with semantic prefixes.
- **Verification**: `cd packages/cli && bun run test` must pass before finishing.
  **Never run bare `bun test`** — bun 1.2.7 x `node:test` fails every file with
  `Failed to get caller source origin`. That is an interop bug, not a real
  failure.
- **TDD at seams**: add the test first, watch it fail when you temporarily
  delete the guard, then restore.
- **Report**: write `.herdr/reports/skillsgate-0m19-agy-coder-1.md` ending with
  a `## Lessons Learned` section (1-3 bullets: what slowed you down, what broke,
  which guard would have prevented it).
- **Heartbeat** at least every 5 minutes and after every commit:
  ```bash
  .herdr/scripts/fleet-heartbeat agy-coder-1 skillsgate-0m19 <pct> "<one-line progress>"
  ```
- **Checkpoint** after each independently verifiable sub-step:
  ```bash
  .herdr/scripts/fleet-checkpoint agy-coder-1 skillsgate-0m19 --done "step1" --next "step2"
  ```
- **Quota**: on 429/401/insufficient_quota, stop and announce BLOCKED with the
  error text. Do not spin.
- **Economy**: batch shell commands with `&&`; write files with a single
  heredoc. Never run `--help` or exploratory introspection.
- **Frozen contract**: the brief is immutable after dispatch. On high-stakes
  ambiguity, STOP and BLOCKED with 2-3 options — never guess.

## 4. Acceptance Criteria (numbered, pass/fail)

1. A new test builds an agent whose `globalSkillsDir` is a symlink pointing at
   `CORE_SKILLS_DIR()`, and asserts every core entry plans as
   `action === "skip-present"`.
2. The same test asserts `action === "link"` never appears for that agent.
3. A second `planCoreSync` over the same state reports zero `link` items
   (idempotence).
4. Removing the guard makes the new test fail (verified by you, guard restored
   afterwards).
5. `cd packages/cli && bun run test` exits 0 with all pre-existing tests green.

## 4b. Scope (machine-checked)

- allow: `packages/cli/src/core/core-skills.test.ts`

## 5. Out of Scope

- Changing guard behaviour in `core-skills.ts` — if you believe the guard is
  wrong, report it in the Lessons Learned and BLOCKED; do not "fix" it here.
- Desktop mirror tests (that is bean skillsgate-o7ni, a different lane).

## 6. Do Not Touch

- `packages/cli/src/core/core-skills.ts` — verified correct 2026-09-29.
- `packages/cli/src/core/agents.ts`.

## 7. Completion Command (Mandatory)

If finished successfully:
```bash
./.herdr/scripts/fleet-done agy-coder-1 skillsgate-0m19 DONE "Added planCoreSync regression coverage for the whole-directory-symlink false-conflict guard" .herdr/reports/skillsgate-0m19-agy-coder-1.md
```

If blocked:
```bash
./.herdr/scripts/fleet-done agy-coder-1 skillsgate-0m19 BLOCKED "<one-line blocker>" .herdr/reports/skillsgate-0m19-agy-coder-1.md
```
