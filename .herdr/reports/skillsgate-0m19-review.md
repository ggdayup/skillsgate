# Review Report: [skillsgate-0m19] - Code Review

- **Bean ID**: `skillsgate-0m19`
- **Agent**: `spark-reviewer-1`
- **Reviewed Commit**: `4d4f23865cb3e5224b2bb025c7c868567ab270ee`
- **Status**: Approved

## Gated Rubric
BEAN: MET
LANDABLE: YES
VERDICT: APPROVE

## Assessment
### 1. Specification Compliance
- Bean `skillsgate-0m19` requires regression coverage for the whole-directory-symlink false-conflict guard in `packages/cli/src/core/core-skills.ts` (`planCoreSync`, reason `"工具目录即 core 目录"`).
- Checklist item 1 (planCoreSync test with agent globalSkillsDir symlinked to core dir): MET. New test in `packages/cli/src/core/core-skills.test.ts:198` builds `agents["codebuddy"]` with `~/.codebuddy/skills -> CORE_SKILLS_DIR()` and calls `planCoreSync({ agentNames: ["codebuddy"] })`.
- Checklist item 2 (every entry `skip-present` with tool-dir-is-core reason): MET. Asserts `items.length === coreCount`, every item `action === "skip-present"`, `reason === "工具目录即 core 目录"`, `agent === "codebuddy"`, and no `link` action.
- Checklist item 3 (second sync zero links / idempotence): MET. Second `planCoreSync` asserts zero `link` items, same length, all `skip-present` with same reason. Also covers the `detectInstalledAgents` path (no explicit `agentNames`) with the same assertions.
- Checklist item 4 (`cd packages/cli && bun run test` passes): MET — verified live in this worktree (see §3).
- Commit is test-only (plus bean markdown status flip and coder completion report). No production code changed, so the documented invariant in AGENTS.md §3 (false-conflict guard via `realpathOrResolve` comparison at `core-skills.ts:291`) is preserved, not altered.
- Negative-path reasoning verified by inspection: without the guard, `inspectAgentEntry` on `path.join(symlinkedDir, name)` would `lstat` through the symlinked parent to a real core directory and return `conflict`/`"同名真实目录"` — exactly the failure mode the coder's TDD step reported (`skip-conflict` instead of `skip-present`). The test's `every(... skip-present ...)` assertion is the load-bearing check; the `items.length === coreCount` check alone would not catch the regression, but it is paired correctly.

### 2. Code Quality, Security & Performance
- Layering: test-only change; no interface/route/domain boundary touched. No new dependencies, no API/schema change, no migration. Backward compatible by construction.
- Error handling / trust boundaries: no new runtime paths; `fs.symlink`/`fs.rm` confined to a per-file `mkdtemp` fake HOME set before engine import (existing harness pattern, `core-skills.test.ts:7-15`). Cleanup in `finally` (`:259-261`) removes `~/.codebuddy` ancestor so later tests/full-plan runs are not polluted.
- Adversarial observations (all non-blocking, noted for completeness):
  1. `fs.mkdir` + `fs.symlink` setup (`:205-207`) sits outside the `try`, so an `EEXIST` on re-run would skip the `finally` cleanup. Unreachable in practice (fresh tmp HOME per file run), but moving setup inside `try` would be strictly more robust.
  2. Idempotence is proven plan-vs-plan with no `applyCoreSync` in between. Since the guard path is plan-time-only and `applyCoreSync` treats `skip-present` as a no-op counter, an interleaved apply would not change the result — the test matches the bean wording literally.
  3. Test uses `agents["codebuddy"]` while AGENTS.md names whole-dir-symlink agents as Antigravity/CodeBuddy CN/Pi/WorkBuddy AI. The guard is agent-agnostic (`realpathOrResolve(dir) === coreRealDir`), so `codebuddy` exercises the identical path and its `detectInstalled` (`dirExists(~/.codebuddy)`) makes the `planCoreSync()` no-args assertion work. Not a defect.
  4. The guard short-circuits before the `core.json` exclusion check, so excluded skills report `skip-present` rather than `skip-excluded` for whole-dir agents. Pre-existing behavior, unchanged by this commit; semantically reasonable since the skills are visible through the dir symlink regardless.
- No security, secrets, traversal, or concurrency concerns introduced. No `fleet-done` or dispatch scripts executed by this reviewer, per assignment rules.
- Worktree noise (not part of commit): unstaged `bun.lock` 1-line diff from local `bun install` provisioning; `git status` also shows the untracked review brief `.herdr/briefs/skillsgate-0m19-review.md`. Neither affects the reviewed commit.

### 3. Verification Output (cd packages/cli && bun run test)
```
ok 1 - agents registry
ok 2 - removeCoreSkill
ok 3 - fan-out links
ok 4 - installDirToCore
ok 5 - resolveLocalSkill
ok 6 - findDanglingCoreEntries
ok 7 - addPathToCore
ok 8 - git repository management
ok 9 - installer security and utilities
ok 10 - skill-discovery — parseSkillMd and discoverSkills resilience
# tests 36
# suites 10
# pass 36
# fail 0
# cancelled 0
# skipped 0
# todo 0
```
- Typecheck (`cd packages/cli && npm run typecheck` → `tsc --noEmit`): exit 0, zero errors.
- Targeted file run (`npx tsx --test 'src/core/core-skills.test.ts'`): 23 tests, 23 pass, 0 fail — includes the new "guards against false conflicts when agent globalSkillsDir is a symlink to core" test under "fan-out links".
- `git log` confirms HEAD is the reviewed commit `4d4f238` (detached HEAD worktree); `git show --stat` confirms the commit touches only the bean markdown, `.herdr/reports/skillsgate-0m19-agy-coder-1.md`, and `packages/cli/src/core/core-skills.test.ts` (+68).
