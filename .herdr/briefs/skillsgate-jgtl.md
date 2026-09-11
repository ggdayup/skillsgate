# Assignment Brief: [skillsgate-jgtl] - Review 7 Harnesses, Evaluate Generalization, and Prepare PR

- **Bean ID**: skillsgate-jgtl
- **Target**: Review, generalization, hardening, and PR preparation
- **Base Commit**: d38dca1

## 1. Objective
1. Conduct an exhaustive review of the 7 newly added agent harnesses (`antigravity`, `codebuddy`, `workbuddy`, `workbuddy-ai`, `trae-cn`, `pi`, `mercury`) across CLI, TUI, and Desktop.
2. Evaluate and apply architectural generalizations:
   - Synchronize `realpathOrResolve` symlink canonical defense into `apps/desktop/src/main/ipc-handlers.ts` (`installSkillToAgent`).
   - Deduplicate `DISPLAY_NAME_TO_KEY` between `agent-logo.tsx` and `home.tsx`.
   - Update `README.md` with the 27-agent badge and comprehensive list of supported agents.
   - Add automated test coverage (`agents.test.ts`) using Node native test runner.
3. Prepare a pristine, rebased PR branch (`feat/support-more-coding-agents`) based on `origin/main`, strictly excluding local-only orchestration files (`.beans/`, `.herdr/`, `AGENTS.md`).
4. Generate a formal herdr review report and provide the PR submission commands.
