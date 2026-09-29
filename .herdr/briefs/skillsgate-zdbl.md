# Assignment Brief: skillsgate-zdbl - Stop the TUI spawning `npx skills`, route installs through SkillsGate

- **Bean ID**: skillsgate-zdbl
- **Target Branch/Worktree**: fleet/agy-coder-4
- **Base Commit**: 0df626d
- **Dispatched To**: agy-coder-4 (agy)
- **Complexity**: M
- **Cost tier**: coder
- **Critical**: no

## 1. Objective

Make the TUI honour the invariant the desktop already honours: install sources
are **parsed, never executed**. Replace the `npx skills add` child process with
SkillsGate's own installer.

## 2. Context & Evidence

- Primary files to inspect:
  - `packages/tui/src/data/use-skill-actions.ts`
    - `:515-526` — `runSkillsAdd()` runs
      `` execAsync(`npx skills add ${source} --all -y`, { timeout: 60_000 }) ``
    - `:143-152` — GitHub / `owner-repo` sources are routed straight into it,
      bypassing SkillsGate's installer entirely.
  - `packages/cli/src/core/installer.ts` — the installer the TUI should be
    calling. The TUI already imports sibling core modules from `packages/cli`
    via deep relative paths (see the import block at `use-skill-actions.ts:12-30`),
    so follow that existing pattern rather than inventing a new one.
  - `packages/skill-sources/src/parse-install-command.ts` — the pure parser;
    file header `:10` states the INVARIANT verbatim.
- Why it matters: spawning executes untrusted text as a child process, pulls a
  package from the npm registry at run time, and performs the install *outside*
  SkillsGate — so no provenance lands in `.skill-lock.json` and no agent fan-out
  or canonical-store link happens. A user who installs from the TUI gets a
  different, worse result than the same install from the Desktop.
- Reference documentation:
  - `docs/adr/0008-pasted-install-commands-are-parsed-never-executed.md` —
    Risk section names this exact line as an open inconsistency.
  - `docs/install-command-paste.md`.

## 3. Strict Rules & Guardrails

- **DO NOT PUSH**: never run `git push`. Commit locally to `fleet/agy-coder-4`.
- **Atomic Commits**: small commits with semantic prefixes.
- **No child process for installs.** After your change there must be no
  `execAsync`, `spawn`, `execFile` or backticked shell string that builds an
  `npx skills add` invocation anywhere in `packages/tui/`.
- **Verification**:
  - `cd packages/cli && bun run test` exits 0.
  - `cd packages/skill-sources && npm test` exits 0.
  - A grep across `packages/tui/` for `npx skills add` returns nothing.
  - `npx tsc --noEmit` (or the repo's existing typecheck entry for the TUI) is
    clean if one exists; if none exists, say so in the report instead of
    inventing one.
- **TDD at seams**: cover the new routing decision (which source shapes go to
  the installer, which still go elsewhere) with a test at the seam you touch.
- **Report**: `.herdr/reports/skillsgate-zdbl-agy-coder-4.md` ending with
  `## Lessons Learned` (1-3 bullets).
- **Heartbeat** every 5 minutes and after every commit:
  ```bash
  .herdr/scripts/fleet-heartbeat agy-coder-4 skillsgate-zdbl <pct> "<one-line progress>"
  ```
- **Checkpoint** after each sub-step:
  ```bash
  .herdr/scripts/fleet-checkpoint agy-coder-4 skillsgate-zdbl --done "step1" --next "step2"
  ```
- **Quota**: on 429/401/insufficient_quota, stop and announce BLOCKED.
- **Economy**: batch shell commands with `&&`; single heredoc per file write;
  never run `--help`.
- **Frozen contract**: on high-stakes ambiguity, BLOCKED with 2-3 options.

## 4. Acceptance Criteria (numbered, pass/fail)

1. `grep -rn "npx skills add" packages/tui/` returns no matches.
2. GitHub / `owner-repo` installs in the TUI go through the shared installer, so
   they produce provenance in `.skill-lock.json` and land in the canonical store
   like a Desktop install does.
3. A failed install surfaces a readable error in the TUI rather than a silent
   partial state (state which mechanism: toast, status line, or whatever the TUI
   already uses — but it must be one of them and covered by a test).
4. The pasted-string invariant holds: no code path in `packages/tui/` passes
   user-controlled text to a shell.
5. `cd packages/cli && bun run test` and `cd packages/skill-sources && npm test`
   both exit 0.

## 4b. Scope (machine-checked)

- allow: `packages/tui/src/data/*`
- allow: `packages/tui/src/components/*`
- allow: `packages/tui/src/views/*`
- allow: `packages/tui/package.json`

## 5. Out of Scope

- The Desktop paste path — already correct, see
  `docs/adr/0008-pasted-install-commands-are-parsed-never-executed.md`.
- `packages/cli/**` and `packages/skill-sources/**`: consume them, do not modify
  them. If you genuinely need a change there, BLOCKED and say what and why.
- Adding new TUI features beyond the routing fix.

## 6. Do Not Touch

- `packages/tui/src/db/**` (bean skillsgate-1w5u holds that path).
- `apps/**`.
- `docs/adr/*`.

## 7. Completion Command (Mandatory)

If finished successfully:
```bash
./.herdr/scripts/fleet-done agy-coder-4 skillsgate-zdbl DONE "Routed TUI GitHub installs through the SkillsGate installer and removed the npx skills add child process" .herdr/reports/skillsgate-zdbl-agy-coder-4.md
```

If blocked:
```bash
./.herdr/scripts/fleet-done agy-coder-4 skillsgate-zdbl BLOCKED "<one-line blocker>" .herdr/reports/skillsgate-zdbl-agy-coder-4.md
```
