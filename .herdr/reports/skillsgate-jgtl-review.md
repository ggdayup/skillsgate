# Gated Review: [skillsgate-jgtl] - Review 7 Harnesses, Evaluate Generalization, and Prepare PR

- **Bean ID**: skillsgate-jgtl
- **Reviewer**: Lead (Antigravity)
- **Harnesses Reviewed**: `antigravity`, `codebuddy`, `workbuddy`, `workbuddy-ai`, `trae-cn`, `pi`, `mercury`
- **Base Commit**: 178159dc465ce5ff9e9d8cc159145036568a189e (origin/main)

---

## 1. Architectural & Code Quality Review

### 1.1 Completeness of the 7 Agent Harnesses
All 7 coding agent harnesses are fully registered and plumbed across every monorepo package:
- `packages/cli/src/types.ts`: `AgentType` union extended.
- `packages/cli/src/core/agents.ts`: Paths, discovery, and runtime detection via CLI binary, config dir, or macOS app bundles.
- `packages/cli/src/core/skill-discovery.ts`: Project-level `.xyz/skills` discovery patterns registered.
- `packages/tui/src/utils/colors.ts`: Two-letter badges and hex colors added.
- `apps/desktop/src/main/ipc-handlers.ts`: Backend `agentRegistry` & `PROJECT_PROBES` registered.
- `apps/desktop/src/renderer/components/agent-logo.tsx`: Vector SVGs, shortcodes, and brand color palette mapped.
- `apps/desktop/src/renderer/assets/agent-logos/`: High-resolution 64x64 vector SVGs created for all agents.

### 1.2 Parity & Security Finding: Desktop Symlink Handling
- **Issue Discovered**: During review, we noted that while `packages/cli/src/core/installer.ts` had received `realpathOrResolve` protection against self-referential symlinks, `apps/desktop/src/main/ipc-handlers.ts` (`installSkillToAgent`) was still using string-based `path.resolve(agentTargetDir) === path.resolve(canonicalDir)`.
  If an agent's directory is a symlink to `~/.agents/skills` (e.g. Antigravity or user symlinks), string comparison failed, causing `installSkillToAgent` to write canonical files, then incorrectly interpret `agentTargetDir` as a non-symlink collision and delete the canonical directory before symlink creation.
- **Resolution**: Ported `realpathOrResolve()` into `apps/desktop/src/main/ipc-handlers.ts`, guaranteeing that both CLI and Desktop safely write once to canonical storage and skip recursive self-symlinks.

### 1.3 Generalization & Deduplication
- **Desktop Renderer Deduplication**: `DISPLAY_NAME_TO_KEY` was duplicated between `home.tsx` and `agent-logo.tsx`. Exported from `agent-logo.tsx` and reused in `home.tsx`, eliminating 30 lines of duplicate mapping.
- **Monorepo Registry Decoupling**: Upstream intentionally mirrors `agentRegistry` between CLI and Electron due to ESM `.js` import resolution issues with Electron/Vite bundling. A unified `@skillsgate/agents` package was evaluated; maintaining the lightweight mirror with automated test enforcement is the least invasive, zero-risk approach for upstream mergeability.
- **Documentation**: Updated `README.md` badge from `20 agents` to `27 agents` and added all 7 harnesses to the Supported Agents list.
- **Automated Verification**: Added unit tests (`packages/cli/src/core/agents.test.ts` and `installer.test.ts`) using Node.js native test runner (`tsx --test`), validating all 27 agents and installer security checks.

---

## 2. Upstream PR Isolation Strategy

Internal orchestration files (`.beans/`, `.herdr/`, `AGENTS.md`) must NOT be part of the upstream Pull Request.
A clean branch `feat/support-more-coding-agents` rebased cleanly on `origin/main` is prepared containing only production changes:
- `packages/cli/` (types, agents, installer, discovery, tests)
- `packages/tui/` (colors)
- `apps/desktop/` (ipc-handlers, logos, agent-logo, home)
- `README.md` (agent count and list)

---

## 3. Strict Verdict

BEAN: MET
LANDABLE: YES
VERDICT: APPROVE
