# SkillsGate — Agent Guidelines & System Knowledge

## 1. Project Overview & Architecture
SkillsGate is a visual AI skill manager for coding agents across Desktop (Electron + React), Terminal UI (Bun + OpenTUI), and CLI (Node.js).

### Monorepo Structure
- `packages/cli`: Core logic, agent registry (`src/core/agents.ts`), installer (`src/core/installer.ts`), types (`src/types.ts`), skill discovery (`src/core/skill-discovery.ts`).
- `packages/tui`: Interactive terminal UI, badge colors (`src/utils/colors.ts`), views (`src/views/skill-detail.tsx`).
- `apps/desktop`: Electron app, main process IPC (`src/main/ipc-handlers.ts`), renderer logo mapping (`src/renderer/components/agent-logo.tsx`), SVG assets (`src/renderer/assets/agent-logos/`).
- `packages/local-db`: SQLite persistence and SSH remote sync client.

---

## 2. Supported Coding Agent Harnesses (27 Agents)
SkillsGate provides unified skill discovery and synchronization across 27 agent targets:

1. **Claude Code** (`claude-code`)
2. **Cursor** (`cursor`)
3. **GitHub Copilot** (`github-copilot`)
4. **Windsurf** (`windsurf`)
5. **Cline** (`cline`)
6. **Continue** (`continue`)
7. **Codex CLI** (`codex-cli`)
8. **Droid CLI** (`droid-cli`)
9. **OB-1** (`ob-1`)
10. **Amp** (`amp`)
11. **Goose** (`goose`)
12. **Junie** (`junie`)
13. **Kilo Code** (`kilo-code`)
14. **OpenCode** (`opencode`)
15. **OpenClaw** (`openclaw`)
16. **Pear AI** (`pear-ai`)
17. **Roo Code** (`roo-code`)
18. **Trae** (`trae`)
19. **Zed** (`zed`)
20. **Universal** (`universal`, `.agents/skills`)
21. **Antigravity** (`antigravity`, `AG`, `.gemini/skills`, `~/.gemini/config/skills` or `~/.gemini/skills`)
22. **CodeBuddy CN** (`codebuddy`, `CB`, `.codebuddy/skills`, `~/.codebuddy/skills`)
23. **WorkBuddy** (`workbuddy`, `WB`, `.workbuddy/skills`, `~/.workbuddy/skills`)
24. **WorkBuddy AI** (`workbuddy-ai`, `WBA`, `.workbuddy-ai/skills`, `~/.workbuddy-ai/skills`)
25. **Trae CN** (`trae-cn`, `TCN`, `.trae-cn/skills`, `~/.trae-cn/skills`)
26. **Pi Coding Agent** (`pi`, `PI`, `.pi/skills`, `~/.pi/agent/skills`)
27. **Mercury Agent** (`mercury`, `MC`, `.mercury/skills`, `~/.mercury/skills`)

---

## 3. Engineering Learnings & Invariants

### Symlink Canonical Store Defense
Many agents (such as Antigravity, CodeBuddy, and Pi) link their global skills directory directly to the Universal store (`~/.agents/skills`).
- **Invariant**: `packages/cli/src/core/installer.ts` must use `realpathOrResolve()` on both the agent target directory and `CANONICAL_SKILLS_DIR()`.
- **Behavior**: When real paths match, the installer writes once to the canonical directory and skips creating self-referential symlinks, preventing filesystem recursion or `EEXIST` failures.

### Cross-Platform Executable Detection
- **Rule**: When detecting installed agent CLI tools via shell commands, never execute `which` directly without checking platform.
- **Implementation**:
  ```ts
  const binary = process.platform === "win32" ? "where" : "which";
  ```

### Worktree Cold-Start & Build Hygiene
- In Git worktrees (`fleet/<agent>`), `node_modules` is not present by default.
- Pre-provision dependencies with `bun install --ignore-scripts` to bypass native Electron rebuild scripts (`electron-rebuild`) during headless CLI verification.
- Run `npm run typecheck --workspace=skillsgate` or `cd packages/cli && bun run typecheck` to verify TypeScript contracts.

---

## 4. Multi-Agent Fleet Orchestration (`herdr-run`)
This project tracks issues via Beans (`.beans/`) and orchestrates fleet agents via Herdr (`.herdr/`):
1. **Bean First**: Every unit of work begins with a committed Bean issue on `main`.
2. **Worktree Isolation**: Coder agents work exclusively in `fleet/<agent-name>` worktrees.
3. **Brief-Driven**: Assignments are dispatched via `.herdr/briefs/<bean-id>.md`.
4. **Mechanical Landing**: Code must NOT be merged without a signed review artifact (`.herdr/reports/<bean-id>-review.md`) carrying `VERDICT: APPROVE` and `LANDABLE: YES`. Use `./.herdr/scripts/fleet-land.sh <bean-id> <commit-hash> ["test-command"]` to enforce this mechanically.
