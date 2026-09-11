# Assignment Brief: [skillsgate-83ay] - Add 7 Coding Agent Harnesses to SkillsGate

- **Bean ID**: skillsgate-83ay
- **Target Branch/Worktree**: fleet/coder-skillsgate
- **Base Commit**: 5afec6b
- **Dispatched To**: coder-1

## 1. Objective
Add first-class support for 7 coding agent harnesses (`antigravity`, `codebuddy`, `workbuddy`, `workbuddy-ai`, `trae-cn`, `pi`, `mercury`) across the entire SkillsGate monorepo (`packages/cli`, `packages/tui`, `apps/desktop`). Enhance `installer.ts` with deep `fs.realpath` normalization to safely handle symlinked `~/.agents/skills` directories without recursive symlink bugs.

## 2. Agent Specifications Matrix
Add the following 7 agents to `packages/cli/src/types.ts` (`AgentType`), `packages/cli/src/core/agents.ts` (`agents`), `apps/desktop/src/main/ipc-handlers.ts` (`agentRegistry`), `packages/tui/src/utils/colors.ts`, `packages/tui/src/views/skill-detail.tsx`, `apps/desktop/src/renderer/components/agent-logo.tsx`, and `apps/desktop/src/renderer/routes/home.tsx`:

1. **`antigravity`**
   - DisplayName: `Antigravity`
   - ShortCode: `AG`
   - Brand Color: `#4285F4`
   - Local skills dir: `.gemini/skills`
   - Global skills dir: `~/.gemini/config/skills` (or fallback `~/.gemini/skills`)
   - Detection: directory `~/.gemini` exists OR `which agy` exists OR `/Applications/Antigravity.app` exists

2. **`codebuddy`**
   - DisplayName: `CodeBuddy CN`
   - ShortCode: `CB`
   - Brand Color: `#0052D9`
   - Local skills dir: `.codebuddy/skills`
   - Global skills dir: `~/.codebuddy/skills`
   - Detection: directory `~/.codebuddy` exists OR `which codebuddy` exists OR `/Applications/CodeBuddy CN.app` exists

3. **`workbuddy`**
   - DisplayName: `WorkBuddy`
   - ShortCode: `WB`
   - Brand Color: `#07C160`
   - Local skills dir: `.workbuddy/skills`
   - Global skills dir: `~/.workbuddy/skills`
   - Detection: directory `~/.workbuddy` exists OR `/Applications/WorkBuddy.app` exists

4. **`workbuddy-ai`**
   - DisplayName: `WorkBuddy AI`
   - ShortCode: `WBA`
   - Brand Color: `#10B981`
   - Local skills dir: `.workbuddy-ai/skills`
   - Global skills dir: `~/.workbuddy-ai/skills`
   - Detection: directory `~/.workbuddy-ai` exists OR `/Applications/WorkBuddy AI.app` exists

5. **`trae-cn`**
   - DisplayName: `Trae CN`
   - ShortCode: `TCN`
   - Brand Color: `#0284C7`
   - Local skills dir: `.trae-cn/skills`
   - Global skills dir: `~/.trae-cn/skills`
   - Detection: directory `~/.trae-cn` exists OR `/Applications/Trae CN.app` exists OR `/Applications/TRAE SOLO CN.app` exists

6. **`pi`**
   - DisplayName: `Pi Coding Agent`
   - ShortCode: `PI`
   - Brand Color: `#8B5CF6`
   - Local skills dir: `.pi/skills`
   - Global skills dir: `~/.pi/agent/skills`
   - Detection: directory `~/.pi/agent` exists OR `which pi` exists

7. **`mercury`**
   - DisplayName: `Mercury Agent`
   - ShortCode: `MC`
   - Brand Color: `#64748B`
   - Local skills dir: `.mercury/skills`
   - Global skills dir: `~/.mercury/skills`
   - Detection: directory `~/.mercury` exists OR `which mercury` exists

## 3. Installer Symlink Self-Reference Defense (`packages/cli/src/core/installer.ts`)
In `installSkillForAgent`:
When `method === "symlink"`, resolve the actual filesystem canonical path of `agentSkillsDir` using `fs.realpath` (or fallback to path.resolve if it doesn't exist yet).
If `realAgentSkillsDir === realCanonicalDir` (i.e. `agentSkillsDir` is a symlink pointing directly to `~/.agents/skills`), treat the agent as natively wired to the canonical store:
- Write to `canonicalDir` once (if not already claimed)
- Skip creating a symlink from `agentTargetDir` to `canonicalDir` (which would attempt to link `~/.agents/skills/foo` to `~/.agents/skills/foo`)
- Return success directly with `path: canonicalDir`.

## 4. UI & Visual Assets
Create SVG logos in `apps/desktop/src/renderer/assets/agent-logos/`:
- `antigravity.svg`
- `codebuddy.svg`
- `workbuddy.svg`
- `workbuddy-ai.svg`
- `trae-cn.svg`
- `pi.svg`
- `mercury.svg`
Import and register them in `apps/desktop/src/renderer/components/agent-logo.tsx`.

## 5. Strict Rules & Guardrails
- **DO NOT PUSH**: Never run `git push`. Commit all changes locally to your worktree branch `fleet/coder-skillsgate`.
- **Atomic Commits**: Create clean semantic commits.
- **Verification**: Run `npm run typecheck --workspace=skillsgate` or `npm run build --workspace=skillsgate` to guarantee zero compile errors.
- **Report**: Write a short completion summary to `.herdr/reports/skillsgate-83ay-coder-1.md`. Must end with `## Lessons Learned`.

## 6. Completion Command
When finished successfully, run:
```bash
./.herdr/scripts/fleet-done coder-1 skillsgate-83ay DONE "Added 7 coding agent harnesses with symlink safety and full-stack assets" .herdr/reports/skillsgate-83ay-coder-1.md
```
