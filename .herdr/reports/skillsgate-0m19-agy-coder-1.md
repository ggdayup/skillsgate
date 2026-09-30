# skillsgate-0m19 Completion Report

## Summary

Added regression test coverage for the whole-directory symlink false-conflict guard in `packages/cli/src/core/core-skills.test.ts`.

The test builds an agent whose global skills directory points at `CORE_SKILLS_DIR()` via a symlink. It verifies that `planCoreSync` plans every core entry as `skip-present` with reason `"工具目录即 core 目录"`. It verifies that `link` actions never appear. It also verifies sync idempotence across repeated plans.

## TDD Verification

1. Added regression test to `packages/cli/src/core/core-skills.test.ts`.
2. Temporarily disabled the false-conflict guard in `packages/cli/src/core/core-skills.ts`. Observed test failure with `AssertionError`. All core entries were reported as `skip-conflict` with reason `"同名真实目录"`.
3. Restored the guard in `packages/cli/src/core/core-skills.ts`.
4. Executed `cd packages/cli && bun run test`. All 36 tests passed in 348 ms.
5. Executed `cd packages/cli && npm run typecheck`. TypeScript type checking passed with zero errors.

## Lessons Learned

- Missing dependencies in freshly provisioned git worktrees cause initial `tsx` command not found test runner failures. Running `bun install` before executing workspace tests resolves this immediately.
- The false-conflict guard relies on `realpathOrResolve`. Without it, resolving child paths through the directory symlink targets real core directories and misclassifies every skill as a non-symlink collision.
