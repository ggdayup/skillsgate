---
# skillsgate-vni2
title: 'docs: backfill Architecture Decision Records into docs/adr'
status: completed
type: task
priority: normal
created_at: 2026-09-29T11:11:41Z
updated_at: 2026-09-29T11:11:52Z
---

The codebase carries significant architectural decisions that exist only in AGENTS.md, commit messages and work logs. Backfill a set of ADRs so a reader of a single file can see the why.

## Scope
- [x] Load architecture-decision-records skill and research the repo
- [x] Create docs/adr/README.md index + template.md
- [x] Write ADR-0001..0008 covering the eight significant decisions
- [x] Validate every file:line citation and every relative link

## Summary of Changes

Added 10 files under `docs/adr/` (directory existed but was empty):

- `README.md` — index table, status vocabulary, creation rules
- `template.md` — MADR-shaped template
- `0001-two-tier-skill-store-and-core-fan-out.md` — `~/.agents/skills` core set + `~/.agents/.store`, dir-is-truth, plan/apply split, four invariants
- `0002-path-identity-via-realpath.md` — `realpathOrResolve` as the identity primitive; write-then-re-verify link creation
- `0003-agent-registry-is-data-with-isolation-pinned-by-tests.md` — 33-entry registry, `agents.test.ts` isolation pins
- `0004-share-logic-mirror-stable-config.md` — shared `@skillsgate/skill-sources` vs mirrored desktop main modules, with bundling rules
- `0005-cli-entry-is-a-platform-binary-forwarder.md` — bin forwarder chain; `src/cli.ts` is unreachable dead code
- `0006-coexist-with-upstream-skills-on-disk.md` — never claim the `skills` bin name; lock-file backup defence
- `0007-shared-local-sqlite-for-cross-surface-state.md` — `~/.skillsgate/skillsgate.db`, WAL, driver injection
- `0008-pasted-install-commands-are-parsed-never-executed.md` — pure parser, parse in main, no spawn

Every `file:line` citation and every relative link was validated against the tree.

### Known gaps surfaced while writing (not fixed, documented as Risks)
- The false-conflict guard at `core-skills.ts:291` has no unit test.
- `apps/desktop/src/main/core-skills.ts` mirror has no test suite.
- DB migrations exist three times and have drifted; `CREATE TABLE IF NOT EXISTS` masks it.
- The TUI still spawns `npx skills add` (`use-skill-actions.ts:515`), contradicting the paste-path invariant.
- README badge says 28 agents; the registry holds 33.
