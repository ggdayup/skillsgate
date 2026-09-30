# Review Report: [skillsgate-zdbl] - Code Review

- **Bean ID**: `skillsgate-zdbl`
- **Agent**: `spark-reviewer-1`
- **Reviewed Commit**: `8102bc734c3aa39136bd3b31f16c1433e6b5678a`
- **Status**: Approved

## Gated Rubric
BEAN: MET
LANDABLE: YES
VERDICT: APPROVE

## Assessment
### 1. Specification Compliance
Bean `skillsgate-zdbl` (ADR-0008 invariant: install sources are parsed, never executed) is met by code commit `bb953b0` (review target `8102bc7` adds only the coder's completion report on top). Checked each numbered acceptance criterion from `.herdr/briefs/skillsgate-zdbl.md`:

1. `grep -rn "npx skills add" packages/tui/` returns no matches — PASS. Verified live: exit 1, zero output. The new test file deliberately constructs the string via `["npx","skills","add"].join(" ")` so the literal never appears on disk; remaining `child_process` hits under `packages/tui/` are the editor launcher (`views/server-skills.tsx` `spawnSync`), the launcher shim (`bin/skillsgate-tui`), and `db/ssh.ts` ssh/tar sync — none build an install invocation, and `db/` is explicitly out of scope for this bean.
2. GitHub / `owner-repo` installs go through the shared installer with lock provenance — PASS. `executeInstallSkill` clones via `cloneRepo`, discovers via `discoverSkills`, fans out via `installSkillForAgent` (global/symlink), and records `addSkillToLock` with `source: github:owner/repo`, `originalUrl`, and `fetchTreeSha` hash. Covered by the "records lock provenance" test asserting exact lock entry shape.
3. Failed install surfaces readable error with no silent partial state — PASS (with one non-blocking observation below). Every failure branch dispatches `SHOW_NOTIFICATION` type `error`; the single-skill failure test asserts `addSkillToLock` is never called. Clone throws, empty discovery, unmatched filter, no-agents, and unresolvable source are each covered by a dedicated test.
4. Pasted-string invariant holds; no user text reaches a shell — PASS. `determineInstallRoute` calls only the pure `tryParseInstallCommand`; `use-skill-actions.ts` contains no `child_process`/`execAsync` import. Downstream `cloneRepo` (simple-git, no shell) validates `ref` against `/^[a-zA-Z0-9._\/-]+$/`. Adversarial probes: `; rm -rf /`, `$(evil)`, backticks, `; rm -rf ~` all reject as unparsable; `&& evil` / `| evil` trailing tokens are captured into `extraSources` and ignored (never executed) — parser leniency, not a shell risk, since nothing is spawned.
5. `cd packages/cli && bun run test` and `cd packages/skill-sources && npm test` both exit 0 — PASS (35/35 and 46/46, re-run by reviewer; plus TUI 25/25 and `tsc --noEmit` clean).

Scope check: touched files are `packages/tui/src/data/*`, `packages/tui/package.json` (test script + `@skillsgate/skill-sources` dep), the new test file, and a bean status flip — all within `§4b allow` plus normal fleet bookkeeping. No changes to `packages/cli/**`, `packages/skill-sources/**`, `packages/tui/src/db/**`, `apps/**`, or `docs/adr/*`.

### 2. Code Quality, Security & Performance
- Layering is correct: thin `determineInstallRoute` / `executeInstallSkill` seams over CLI core (`git`, `skill-discovery`, `installer`, `skill-lock`, `agents`) and the shared `@skillsgate/skill-sources` parser, following the file's existing deep-relative import pattern. Dependency-injection (`InstallSkillDependencies`) makes the seam fully testable without mounting UI.
- Error handling is fail-closed: unknown source shapes return `unsupported` with a readable reason instead of falling through to any legacy path; the old `isOwnerRepoFormat` → `runSkillsAdd` branch and the `exec` import are deleted, not just bypassed.
- One behavior change to note (non-blocking): with no `--skill` filter, the new code narrows to `skill.name` when it matches a discovered skill, whereas the old local path installed everything discovered. This is the less-surprising behavior for a per-skill install action; no criterion forbids it.
- Non-blocking observation: multi-skill installs write the lock per skill inside the loop, so if skill N fails after skill N-1 succeeded, N-1's lock entry persists. That is arguably correct (N-1 did install) and the single-failure test pins the important invariant (failed skill ⇒ no lock). Not a land-blocker.
- Temp-dir hygiene: `finally { if (tmpDir) cleanup }` only cleans the clone dir; local paths are never deleted. `fetchTreeSha` failures degrade to `""` rather than failing the install.

### 3. Verification Output (cd packages/cli && bun run test)
```
# tests 35
# suites 10
# pass 35
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 803.523917
```
Additional gates re-run by reviewer (all exit 0):
- `cd packages/skill-sources && npm test`: 46 pass / 0 fail.
- `cd packages/tui && bun run test`: 25 pass / 0 fail (incl. "Invariant: no shell child processes in TUI").
- `npx tsc -p packages/tui/tsconfig.json --noEmit`: clean, 0 errors.
- `grep -rn "npx skills add" packages/tui/`: no output, exit 1.
