# Architecture Decision Records

This directory contains the Architecture Decision Records (ADRs) for SkillsGate.

These records were **backfilled on 2026-09-29** from the code, `AGENTS.md`,
`docs/install-command-paste.md`, commit messages and the fleet work logs. Before
that date the decisions lived only in those places, which meant the *why* was
invisible to anyone reading a single file. Statuses are recorded as they stand
today; where a decision was reached earlier, the originating date and commit are
cited in the ADR body.

## Index

| ADR | Title | Status | Decided |
| --- | --- | --- | --- |
| [0001](0001-two-tier-skill-store-and-core-fan-out.md) | Two-tier skill store with core-set fan-out | Accepted | 2026-09-14 |
| [0002](0002-path-identity-via-realpath.md) | Path identity via `realpath`, never literal path equality | Accepted | 2026-09-14 |
| [0003](0003-agent-registry-is-data-with-isolation-pinned-by-tests.md) | Agent registry is data; directory isolation is pinned by tests | Accepted | 2026-09-15 |
| [0004](0004-share-logic-mirror-stable-config.md) | Share behavioural layers, mirror small stable config | Accepted | 2026-09-19 |
| [0005](0005-cli-entry-is-a-platform-binary-forwarder.md) | The CLI entry is a forwarder to the TUI platform binary | Accepted | 2026-02-27 |
| [0006](0006-coexist-with-upstream-skills-on-disk.md) | Coexist with upstream `skills` on disk, never compete for its name | Accepted | 2026-09-19 |
| [0007](0007-shared-local-sqlite-for-cross-surface-state.md) | Shared local SQLite for state common to Desktop and TUI | Accepted | 2026-03-22 |
| [0008](0008-pasted-install-commands-are-parsed-never-executed.md) | Pasted install commands are parsed, never executed | Accepted | 2026-09-19 |
| [0009](0009-persistent-github-repo-store.md) | Persistent GitHub repository store under `~/.agents/.store/repos` | Accepted | 2026-09-28 |
| [0010](0010-core-skill-source-resolution-and-detach-mode.md) | Dynamic Core source resolution via symlink targets and non-destructive Detach mode | Accepted | 2026-09-30 |
| [0011](0011-skills-library-cold-storage-tier.md) | Skills library cold storage tier (`~/.agents/skills-library`) | Accepted | 2026-09-29 |

## Creating a new ADR

1. Copy [`template.md`](template.md) to `NNNN-title-with-dashes.md`.
2. Number it as the next zero-padded sequence; never renumber existing files.
3. Fill in every section. `## Considered Options` and `## Consequences` are not
   optional — an ADR that records only the chosen option is a changelog entry.
4. Update the index table above.
5. Submit for review.

## Status values

- **Proposed** — under discussion, not yet binding.
- **Accepted** — decided and in force.
- **Deprecated** — was right, no longer relevant.
- **Superseded** — replaced by a later ADR; that ADR must link back.
- **Rejected** — considered and deliberately not adopted. Worth keeping.

## Rules

- **Never edit an accepted ADR.** If the decision changes, write a new ADR that
  supersedes it and flip the old one's status.
- **Keep them short.** One to two pages. Link to code rather than restating it.
- **Cite `file:line`.** A reader should be able to land on the code that proves
  the ADR.
- **Be honest about the cons.** Several decisions below carry known drift or
  maintenance costs; hiding them would make the record useless.
