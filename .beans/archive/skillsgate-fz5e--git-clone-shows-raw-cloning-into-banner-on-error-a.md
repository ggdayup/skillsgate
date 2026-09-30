---
# skillsgate-fz5e
title: Git clone shows raw 'Cloning into...' banner on error and times out on larger repos
status: completed
type: bug
priority: high
created_at: 2026-09-28T07:39:52Z
updated_at: 2026-09-28T07:46:10Z
---

When git clone fails or times out in the desktop Sources view, the error banner in AddSourceModal displays the informational stderr line 'Cloning into ...' instead of extracting the real root cause or diagnosing timeouts. Furthermore, git timeout is too short for medium/large repos, PATH order prioritizes /usr/bin over homebrew git, and GIT_TERMINAL_PROMPT is not disabled.


## Todo List
- [x] Read Principles section in full
- [x] 1. Reproduce defect: synthesize trigger and demonstrate raw 'Cloning into...' stderr capture and timeout
- [x] 2. Binary-search the cause: verify gitExec stderr parsing, timeout duration, and environment
- [x] 3. Plan the fix: sanitize git stderr, handle timeouts cleanly, raise git timeout, fix PATH precedence and GIT_TERMINAL_PROMPT
- [x] 4. Verify on the same surface: test repro passes and clean error/success is returned
- [x] 5. Stage commits: failing test / repro before fix
- [x] 6. Summary and release

## Summary of Changes
- Created `extractGitErrorMessage` in `apps/desktop/src/main/git-repo.ts` to filter out benign stderr progress lines (`Cloning into`, `Receiving objects`, etc.) and surface genuine fatal errors or clear timeout messages.
- Updated `buildCliEnv()` to prioritize `COMMON_BIN_DIRS` (such as `/opt/homebrew/bin`) ahead of system PATH and set `GIT_TERMINAL_PROMPT: '0'` to prevent interactive hangs.
- Extended `gitClone` timeout to 180 seconds to accommodate larger GitHub repositories.
- Updated `scan-sources.tsx` error banner styling with `whitespace-pre-line break-words font-mono` for legible multi-line git error formatting.
- Added comprehensive unit tests in `apps/desktop/src/main/git-repo.test.ts` verifying timeout diagnostics, error filtering, and environment setup.
