# Review Report: [skillsgate-o7ni] - Code Review

- **Bean ID**: `skillsgate-o7ni`
- **Agent**: `spark-reviewer-1`
- **Reviewed Commit**: `3fb8077351629d29e5407371d740f7b31535aa5a`
- **Status**: Approved

## Gated Rubric
BEAN: MET
LANDABLE: YES
VERDICT: APPROVE

## Assessment
### 1. Specification Compliance
All 5 numbered acceptance criteria from `.herdr/briefs/skillsgate-o7ni.md` are MET:

1. **Test file exists with required groups** — `apps/desktop/src/main/core-skills.test.ts` (339 lines, 4 commits: `247ba1e`, `dfeb56f`, `425df1e`, `3fb8077`) covers remove/detach/purge semantics (7 tests), fan-out links + symlinked-ancestor regression (1 test), `installDirToCore` (6 tests), `findDanglingCoreEntries` (1 test). Matches the CLI source ranges cited in the brief (`:71-168`, `:170-195`, `:197-301`, `:372-385`). CLI-only groups (`resolveLocalSkill`, `addPathToCore`) are correctly not ported — the desktop mirror has no such functions; it uses injected-agent `planCoreSync(agents)` + `installDirToCore` instead.
2. **Divergence pinned, not erased** — test `defaults to copy mode when mode is omitted (pinned divergence from CLI, which defaults to link)` asserts `lstat.isDirectory() && !isSymbolicLink()` and carries a comment documenting that CLI `packages/cli/src/core/core-skills.ts` defaults to `mode ?? "link"` because the core dir is git-tracked. Verified against CLI test line 237-248 which asserts the opposite default. Correct.
3. **`test` script exists and is green without Electron** — `apps/desktop/package.json` now has `"test": "tsx --test 'src/main/*.test.ts'"`, mirroring the CLI pattern. Ran `npm run test`: 19 tests / 5 suites, all pass, no Electron launch. Also ran `npx tsc --noEmit`: exit 0.
4. **Suite guards the CLI invariant** — `never touches a link that points outside the core set` exercises `unlinkCoreLinkFromAgent`'s `abs.startsWith(coreDir + sep)` guard in `core-skills.ts:560`. If that guard were removed, the test's `unlinked == 0` + link-survives assertions would fail. The traversal-neutralisation tests (`../../escape`, `../outside` → sanitized names) further pin the `sanitizeName` + `isPathSafe` boundary. Criterion met.
5. **CLI gate unbroken** — `cd packages/cli && bun run test`: 35 tests / 10 suites, all pass (see §3).

Scope check (machine-checked allow-list): `git diff 5cfd872..HEAD --stat` shows only `apps/desktop/src/main/core-skills.test.ts` (new) and `apps/desktop/package.json` (+1 line). `apps/desktop/src/main/core-skills.ts` untouched (allowed but correctly left alone), `packages/cli/**` untouched, `ipc-handlers.ts` untouched, `db/**` untouched. No scope violation.

Note: working tree shows an unstaged `bun.lock` version bump (`0.6.6` → `0.6.7`); it is not part of `5cfd872..HEAD` and is not attributable to this bean. Ignored for this verdict.

### 2. Code Quality, Security & Performance
- **Layering / architecture**: test-only change plus one package.json script line. No business logic moved. Fake-`HOME` setup precedes module load (satisfies `skill-paths.ts` resolution, not the CLI's), and the injected-agent calling convention (`removeCoreSkill(name, [agent])`, `planCoreSync([agent])`) correctly reflects the mirror's testability seam noted in the brief. Consistent with ADR-0004 (mirror, don't unify) and AGENTS.md mirror convention. No `better-sqlite3` import in the suite — hermetic as required.
- **Security (adversarial)**: reviewed `unlinkCoreLinkFromAgent` (`core-skills.ts:550-566`) — only unlinks symlinks whose resolved target is inside `CORE_SKILLS_DIR`; real dirs/files reported as residual, never deleted except in explicit `purge` mode. `installDirToCore`/`removeCoreSkill` sanitize names and enforce `isPathSafe`; traversal inputs cannot escape (verified by assertions on `..-outside` basename and `path.startsWith(coreDir)`). No auth/token/concurrency surface exists here — local-fs engine, sequential ops, per-run `mkdtemp` HOME with `after()` restore of `HOME`/`USERPROFILE`/`CLAUDE_CONFIG_DIR`/`XDG_CONFIG_HOME` and `rm -rf`. No defect found.
- **Test hygiene**: unique skill names per case avoid cross-test collision; shared temp HOME is acceptable given sequential `node:test` execution. Minor non-blocking nits: suite uses `require()` for the two mirror modules while the CLI suite uses `await import()` (works under `tsx`, stylistic only); file ends with a double blank line. Neither affects correctness or landing.
- **Performance**: 15 fs-heavy tests complete in ~180ms (desktop) / ~790ms (CLI full gate). No concern.

No blocking defects found. The review was adversarial: I checked for missing groups, wrong defaults, scope creep, invariant-guard erosion, traversal escapes, and gate regressions — all clear.

### 3. Verification Output (cd packages/cli && bun run test)
```
$ tsx --test 'src/core/*.test.ts'
TAP version 13
ok 1 - agents registry (8 subtests)
ok 2 - removeCoreSkill (7 subtests)
ok 3 - fan-out links (1 subtest)
ok 4 - installDirToCore (6 subtests)
ok 5 - resolveLocalSkill (6 subtests)
ok 6 - findDanglingCoreEntries (1 subtest)
ok 7 - addPathToCore (1 subtest)
ok 8 - git repository management (2 subtests)
ok 9 - installer security and utilities (2 subtests)
ok 10 - skill-discovery — parseSkillMd and discoverSkills resilience (1 subtest)
1..10
# tests 35
# suites 10
# pass 35
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 788.539792
```

Desktop suite (`cd apps/desktop && npm run test` — supplementary, required by bean criterion 3):
```
1..5
# tests 19
# suites 5
# pass 19
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 183.555667
```
Suites: removeCoreSkill (7), fan-out links (1), installDirToCore (6), findDanglingCoreEntries (1), git-repo error extraction (4, pre-existing).
Typecheck (`npx tsc --noEmit -p tsconfig.json` in `apps/desktop`): EXIT 0.
