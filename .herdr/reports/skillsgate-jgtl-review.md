# Gated Review: [skillsgate-jgtl] - Review 7 Harnesses, Evaluate Generalization, and Prepare PR

- **Bean ID**: skillsgate-jgtl
- **Reviewer**: Lead (Antigravity)
- **Harnesses Reviewed**: `antigravity`, `codebuddy`, `workbuddy`, `workbuddy-ai`, `trae-cn`, `pi`, `mercury`
- **Base Commit**: 178159dc465ce5ff9e9d8cc159145036568a189e (origin/main)
- **Reviewed Head**: `5ebbf86` on `feat/support-more-coding-agents` (added 2026-10-04)

> **Correction (2026-10-04).** This report originally named only the base commit
> `178159dc`, which was `origin/main` at rebase time — **not** the object under
> review. That sha predates the work by three days (2026-09-08 vs `bd97b8b` on
> 2026-09-11) and contains none of the seven harnesses, so it cannot be the
> subject. The subject was the five-commit branch `feat/support-more-coding-agents`,
> head `5ebbf86`. The bean brief `.herdr/briefs/skillsgate-jgtl.md` cites a third,
> also-correct value, `d38dca1` ("chore(beans): add skillsgate-jgtl"), which is
> the dispatch point. Three shas, three different meanings, none of them labelled.
>
> Branch commits reviewed, and where each ended up:
>
> | Commit | Subject | In `main` as |
> | --- | --- | --- |
> | `963c496` | feat(harnesses): add 7 coding agent harnesses | superseded by `bd97b8b` |
> | `4d3eba4` | test(cli): add unit tests for agent registry | `packages/cli/src/core/agents.test.ts` present; patch not equivalent |
> | `d7d02b1` | docs: update README to 27 supported agents | superseded — README now says 33 |
> | `48397f7` | fix(codebuddy): detection and renderer alias | `12ba377` |
> | `5ebbf86` | feat(codebuddy): split CodeBuddy / CodeBuddy CN | `35f8488` |
>
> The branch was never merged and `feat/support-more-coding-agents` is still
> unmerged, but its content reached `main` by other routes. As with
> `skillsgate-83ay`, the APPROVE verdict below was correct at the time and is not
> clearance to land the branch now — two of its five commits were superseded by
> later work on `main` that this review did not see.

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

```
BEAN: MET
LANDABLE: YES
VERDICT: APPROVE
```

Correct as a review of `5ebbf86` / `feat/support-more-coding-agents` at the time.
The branch itself was never landed — see the correction note at the top.
