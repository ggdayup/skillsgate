# Assignment Brief: skillsgate-g2y2 - Correct the agent-count badge (28 -> 33)

- **Bean ID**: skillsgate-g2y2
- **Target Branch/Worktree**: fleet/agy-coder-5
- **Base Commit**: 0df626d
- **Dispatched To**: agy-coder-5 (agy)
- **Complexity**: S
- **Cost tier**: coder
- **Critical**: no

## 1. Objective

`README.md` advertises 28 supported agents; the registry holds **33**, pinned by
`packages/cli/src/core/agents.test.ts`. Fix every stale count in `README.md` and
make sure the prose agent list matches the registry.

## 2. Context & Evidence

- Primary file to inspect:
  - `README.md`
    - line 16 — shields.io badge `agents-28` / `28 agents`
    - line 28 — "It works with 28+ agents"
    - line 60 — the "Supported Agents" paragraph
- The authority:
  - `packages/cli/src/core/agents.ts` — the registry (33 entries).
  - `packages/cli/src/core/agents.test.ts:56` — asserts
    `Object.keys(agents).length === 33`.
  - `AGENTS.md` section 2 — the numbered list of 33.
- The four seam cases the README already calls out in blockquotes and must keep
  getting right: Gemini CLI vs the three Antigravity interfaces,
  Qoder vs Qoder CN, CodeArts Doer vs OpenCode, CodeBuddy vs CodeBuddy CN.
- Reference documentation:
  - `docs/adr/0003-agent-registry-is-data-with-isolation-pinned-by-tests.md` —
    Negative consequences names this README drift explicitly.

## 3. Strict Rules & Guardrails

- **DO NOT PUSH**: never run `git push`. Commit locally to `fleet/agy-coder-5`.
- **Atomic Commits**: one commit, README only.
- **Verification**: after editing, count the agents you list in the README
  paragraph and confirm it equals 33, and confirm the badge says 33.
- **Report**: `.herdr/reports/skillsgate-g2y2-agy-coder-5.md` ending with
  `## Lessons Learned` (1-3 bullets).
- **Heartbeat** every 5 minutes and after every commit:
  ```bash
  .herdr/scripts/fleet-heartbeat agy-coder-5 skillsgate-g2y2 <pct> "<one-line progress>"
  ```
- **Checkpoint**:
  ```bash
  .herdr/scripts/fleet-checkpoint agy-coder-5 skillsgate-g2y2 --done "readme-updated" --next "verify-counts"
  ```
- **Quota**: on 429/401/insufficient_quota, stop and announce BLOCKED.
- **Economy**: batch shell commands with `&&`; never run `--help`.
- **Frozen contract**: on ambiguity, BLOCKED — do not guess which agents are
  missing from the list; derive it from `packages/cli/src/core/agents.ts`.

## 4. Acceptance Criteria (numbered, pass/fail)

1. The badge renders `33 agents`.
2. No occurrence of "28 agents" or "28+" remains anywhere in `README.md`.
3. The "Supported Agents" paragraph lists exactly the 33 keys in
   `packages/cli/src/core/agents.ts`, with no additions and no omissions.
4. The four blockquote seam notes (Antigravity x3, Gemini CLI, Qoder/Qoder CN,
   CodeArts Doer, CodeBuddy/CodeBuddy CN) are still present and still accurate.
5. `cd packages/cli && bun run test` exits 0 (you did not touch code).

## 4b. Scope (machine-checked)

- allow: `README.md`

## 5. Out of Scope

- `AGENTS.md` — already says 33.
- `docs/adr/*`.
- Any source file.

## 6. Do Not Touch

- Everything outside `README.md`.

## 7. Completion Command (Mandatory)

If finished successfully:
```bash
./.herdr/scripts/fleet-done agy-coder-5 skillsgate-g2y2 DONE "Corrected the README agent badge and supported-agent list from 28 to 33" .herdr/reports/skillsgate-g2y2-agy-coder-5.md
```

If blocked:
```bash
./.herdr/scripts/fleet-done agy-coder-5 skillsgate-g2y2 BLOCKED "<one-line blocker>" .herdr/reports/skillsgate-g2y2-agy-coder-5.md
```
