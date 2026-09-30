# skillsgate-zdbl Completion Report

## Summary

The TUI now adheres to the pure-parser invariant defined in ADR-0008. Install sources are parsed and never executed as shell commands.

1. Removed `runSkillsAdd`, `execAsync`, and `node:child_process` from `packages/tui/src/data/use-skill-actions.ts`.
2. Routed GitHub and local installs through SkillsGate's shared installer pipeline. Installs clone via `cloneRepo`, discover skills, write to the canonical store, create agent symlinks via `installSkillForAgent`, and record lock provenance via `addSkillToLock`.
3. Extracted `determineInstallRoute` and `executeInstallSkill` as explicit testable seams using `@skillsgate/skill-sources`.
4. Prevented silent failures and partial state. Any install failure halts lock updates and surfaces a readable notification toast through `SHOW_NOTIFICATION`.
5. Added a 25-case automated test suite in `packages/tui/src/data/use-skill-actions.test.ts`.

## Verification Results

- `grep -rn "npx skills add" packages/tui/` returned 0 matches.
- `cd packages/cli && bun run test` passed with 35 passing tests.
- `cd packages/skill-sources && npm test` passed with 46 passing tests.
- `cd packages/tui && bun run test` passed with 25 passing tests.
- `npx tsc -p packages/tui/tsconfig.json --noEmit` passed with 0 errors.

## Acceptance Criteria Status

1. `grep -rn "npx skills add" packages/tui/` returns no matches. Passed.
2. GitHub and owner-repo installs go through the shared installer and produce lock provenance. Passed.
3. Failed installs surface readable error toasts in the TUI without partial lock states. Passed.
4. Pasted-string invariant holds with no user input passed to a shell. Passed.
5. CLI and skill-sources test suites exit 0. Passed.

## Lessons Learned

- Shared workspace parsers should be consumed directly across interfaces instead of maintaining divergent ad-hoc string manipulations.
- Seam extraction with dependency injection enables thorough testing of CLI and TUI actions without requiring full terminal UI mounting.
