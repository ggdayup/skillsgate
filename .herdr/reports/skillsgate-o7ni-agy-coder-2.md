# skillsgate-o7ni Completion Report

## Summary

Ported the core-sync engine test suite from `packages/cli/src/core/core-skills.test.ts` to `apps/desktop/src/main/core-skills.test.ts`. Added a non-Electron test script to `apps/desktop/package.json` invoking `tsx --test 'src/main/*.test.ts'`.

## Test Suite Coverage

The new desktop test suite provides hermetic coverage with a temporary `HOME` directory for four key areas:

1. `removeCoreSkill` remove semantics:
   - Drops the core entry and unlinks it from each tool.
   - Preserves a real directory in canonical store when detaching from core.
   - Purges a skill completely from core, store, and library in purge mode.
   - Sweeps a dangling tool link when the core entry is already gone.
   - Leaves a tool's own copy alone and reports it as residual.
   - Preserves links pointing outside the core set.
   - Neutralises traversal-shaped skill names.

2. `fan-out links` ancestor symlink resolution:
   - Verifies links for tools whose skills directory sits behind a symlinked ancestor.
   - Tests relative path resolution and idempotency across multiple sync runs.

3. `installDirToCore` directory installation and pinned divergence:
   - Tests `mode: "link"` symlink installation.
   - Tests `mode: "copy"` directory installation.
   - Pins the deliberate divergence where desktop defaults to `copy` while CLI defaults to `link`. The desktop core directory is git-tracked and requires real files.
   - Replaces existing entries and saves backups under `.backup` when `replace: true`.
   - Rejects clobbering existing entries when `replace: false`.
   - Neutralises path traversal in skill names.

4. `findDanglingCoreEntries` broken symlink detection:
   - Detects dangling symlinks inside the core skills directory when external source directories disappear.

## Verification

Both test suites were executed and verified green:

- `cd apps/desktop && bun run test` executed 19 tests across 5 suites with 0 failures.
- `cd apps/desktop && npm test` executed 19 tests across 5 suites with 0 failures.
- `cd packages/cli && bun run test` executed 35 tests across 10 suites with 0 failures.

## Lessons Learned

- Desktop TypeScript modules run under CommonJS in `tsx` because `apps/desktop/package.json` lacks `"type": "module"`. Setting up fake `HOME` environment paths before module loading requires synchronous filesystem initialization rather than top-level await.
- Injecting `CoreAgent[]` into desktop `planCoreSync` and `removeCoreSkill` makes the engine decoupled from IPC handlers and fully testable in isolation.
