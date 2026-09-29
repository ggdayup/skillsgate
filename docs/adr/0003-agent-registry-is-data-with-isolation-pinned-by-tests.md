# ADR-0003: Agent registry is data; directory isolation is pinned by tests

## Status

Accepted · 2026-09-15

Backfilled 2026-09-29. Split of Antigravity into three entries in `384340b`;
registry stands at **33** agents.

## Context

SkillsGate's value depends on knowing, for each supported harness, where its
global skills directory is and how to tell whether it is installed. This looked
like a simple lookup table until the ecosystem turned out to be full of near
collisions:

- Google ships **three Antigravity interfaces** (2.0 app, IDE, `agy` CLI) plus
  **Gemini CLI**, and all four live under `~/.gemini`. Gemini CLI owns
  `~/.gemini/skills`; the Antigravity family owns `~/.gemini/config/skills` and
  `~/.gemini/<product>/skills`. `~/.gemini` itself is created by several
  unrelated products and is therefore worthless as a signal.
- Alibaba ships **Qoder** and **Qoder CN** as separate editions with separate
  roots (`~/.qoder/skills`, `~/.qoder-cn/skills`).
- **CodeArts Doer** wraps opencode — its config even carries the opencode
  `$schema` — but `PLUGIN_ENV=hc` makes it read `~/.codeartsdoer/skills`, never
  `~/.opencode/skills`.
- A "universal" pseudo-agent once existed and caused a core-set conflation.

Adding a wrong entry does not fail at runtime; it silently installs skills into
a directory another product reads, or reports an agent as installed when only a
shared directory exists.

## Decision Drivers

- **Must** keep one directory per harness where the ecosystems separate them.
- **Must** make a wrong entry fail in CI, not in a user's home directory.
- Detection must work cross-platform without executing a bare `which`.

## Considered Options

### Option 1: A static registry object plus tests that assert isolation

- **Pros**: pure data, trivially inspectable; each subtle ecosystem fact is
  recorded as an assertion that cannot regress silently.
- **Cons**: tests only catch what someone already thought to assert; a brand-new
  collision of an unmodelled kind still needs a human.

### Option 2: Probe the filesystem at runtime and infer directories

- **Pros**: no table to maintain.
- **Cons**: non-deterministic; `~/.gemini` proves inference guesses. Rejected —
  it is precisely the ambiguity this design avoids.

### Option 3: Derive directories from each tool's own config file

- **Pros**: authoritative when present.
- **Cons**: format differs per tool, many tools have no config until first run,
  and the tools are third-party. Too fragile as a primary source.

## Decision

Declare every harness as data in `packages/cli/src/core/agents.ts`:

```ts
// packages/cli/src/types.ts:42
export interface AgentConfig {
  name: AgentType;
  displayName: string;
  skillsDir: string;        // project-relative, e.g. ".claude/skills"
  globalSkillsDir: string;  // absolute,     e.g. ~/.claude/skills
  detectInstalled: () => Promise<boolean>;
}
```

- Detection uses two primitives: `dirExists()` and `commandExists()`, where the
  shell binary is chosen by platform — `win32 ? "where" : "which"`
  (`packages/cli/src/core/agents.ts:32`). Never a bare `which`.
- Env overrides are explicit (`XDG_CONFIG_HOME`, `CLAUDE_CONFIG_DIR`,
  `CODEX_HOME`, `FACTORY_HOME`, `OB1_HOME`).
- `detectInstalledAgents()` runs them concurrently and filters.

**Core is not an agent.** `~/.agents/skills` is a source that fans out; it is
never an install target, and `getCoreAgents()` excludes it.

Isolation is then *pinned* by `packages/cli/src/core/agents.test.ts`:

| Assertion | Guards against |
| --- | --- |
| registry length `=== 33` | silent loss of a harness |
| `qoder.globalSkillsDir !== qoder-cn.globalSkillsDir` | edition merge |
| `codeartsdoer` dir ≠ opencode dir, no `cli-data` | treating the opencode wrapper as opencode |
| three Antigravity dirs distinct, all under `~/.gemini` | interface merge |
| Gemini CLI owns `/.gemini/skills`, ≠ all three Antigravity dirs | product merge |
| `agents["universal"] === undefined` | the old pseudo-agent |

## Consequences

### Positive

- Each non-obvious ecosystem fact is executable documentation.
- `AgentType` is a closed union, so a typo is a type error rather than an
  invisible new key.

### Negative

- **The registry exists twice**: `packages/cli/src/core/agents.ts` and a mirror
  inline in `apps/desktop/src/main/ipc-handlers.ts:78` (the desktop copy adds a
  `shortCode` for badges and drops `skillsDir`). Only the CLI copy is covered by
  `agents.test.ts` — the desktop mirror's 33 entries are not asserted. See
  [ADR-0004](0004-share-logic-mirror-stable-config.md).
- The count test is a hard number: adding an agent requires touching a test,
  which is mildly annoying and entirely the point.
- README badges still advertise "28 agents" while the registry holds 33 —
  prose drifts even when tests do not.

### Risks

- **A new product shares a directory with an existing one and nobody adds an
  assertion.** Mitigation: AGENTS.md carries the narrative for the known traps
  (never use bare `~/.gemini` as a signal; never map
  `/Applications/Antigravity Tools.app`, which is third-party).

## Implementation Notes

- `packages/cli/src/core/agents.ts` (33 entries)
- `packages/cli/src/types.ts:3` — closed `AgentType` union
- `apps/desktop/src/main/ipc-handlers.ts:78-141` — desktop mirror
- `packages/cli/src/core/agents.test.ts` — isolation pins

## Related Decisions

- [ADR-0001](0001-two-tier-skill-store-and-core-fan-out.md) — the registry is
  what the fan-out iterates over.

## References

- `384340b` split Antigravity into CLI / IDE / 2.0
- `35f8488` separate CodeBuddy and CodeBuddy CN
- `c9babac` CodeArts Doer
- `AGENTS.md` §2
