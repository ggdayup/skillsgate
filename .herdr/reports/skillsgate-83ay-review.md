# Gated Review: [skillsgate-83ay] - Add 7 Coding Agent Harnesses to SkillsGate

- **Bean ID**: skillsgate-83ay
- **Reviewer**: Lead (Antigravity)
- **Coder**: coder-codex (OpenAI Codex CLI)
- **Commit Evaluated**: 652a1bd01750f3d7cc48e6423c2a31b7cb0b28ba

---

## 1. Acceptance Criteria Verification

### Criterion 1: 7 Agent Harnesses Added Across Entire Stack
- `packages/cli/src/types.ts`: `AgentType` updated with `antigravity | codebuddy | workbuddy | workbuddy-ai | trae-cn | pi | mercury` (MET)
- `packages/cli/src/core/agents.ts`: 7 new `AgentConfig` entries registered with path definitions and detection logic (MET)
- `packages/cli/src/core/skill-discovery.ts`: Project discovery suffixes updated (MET)
- `packages/tui/src/utils/colors.ts`: Badges `AG`, `CB`, `WB`, `WBA`, `TCN`, `PI`, `MC` and brand colors registered (MET)
- `apps/desktop/src/main/ipc-handlers.ts`: Electron `agentRegistry` & `PROJECT_PROBES` registered (MET)
- `apps/desktop/src/renderer/assets/agent-logos/`: All 7 vector SVGs in place (MET)
- `apps/desktop/src/renderer/components/agent-logo.tsx`: SVG imports and component logo mapping registered (MET)
- `apps/desktop/src/renderer/routes/home.tsx`: `DISPLAY_NAME_TO_KEY` registered (MET)

### Criterion 2: Installer Symlink Self-Reference Defense
- `packages/cli/src/core/installer.ts`: Uses `realpathOrResolve(agentSkillsDir)` and `realpathOrResolve(CANONICAL_SKILLS_DIR())`.
- When an agent's directory is a symlink pointing directly to `~/.agents/skills`, `isCanonicalAgent` evaluates to true, writes once to canonical store, and safely bypasses redundant/recursive symlink creation. (MET)

### Criterion 3: Scope Drift Check
- Verified against brief: No extraneous modifications. `bun.lock` churn from dependency installation was cleanly reverted by the coder before committing. (MET)

### Criterion 4: Build & Typecheck
- `tsup` build in `packages/cli` succeeds (13ms).
- `tsc --noEmit` exits with zero errors across the monorepo. (MET)

---

## 2. Findings & Fixes During Review

- **Finding**: The original coder implementation used `which` directly inside `commandExists()` (`packages/cli/src/core/agents.ts` and `apps/desktop/src/main/ipc-handlers.ts`), which is macOS/Linux specific and fails on Windows (where `where.exe` is standard).
- **Fix Applied**: Patched `commandExists` across CLI and Desktop to `const binary = process.platform === "win32" ? "where" : "which"`. Rebuilt and re-verified.

---

## 3. Strict Verdict

BEAN: MET
LANDABLE: YES
VERDICT: APPROVE
