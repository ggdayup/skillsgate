# Lane Registry

Project-local lanes under `.herdr/lanes/`. Each lane pins a harness + model.

| Lane | Harness | Model pin | Role | Group |
|------|---------|-----------|------|-------|
| `agy-coder-1..5` | agy | `gemini-3.8-flash-high` | coder | `bulk` |
| `spark-reviewer-1` | opencode | `opencode/muse-spark-1.3-contributor-free` | reviewer | `review` |

## Priority

1. **agy (primary)** — coders. Strongest verified model, `--effort high`.
2. **muse-spark (review)** — cross-harness reviewer. Reviews agy output only; it
   never reviews its own family.

Codex is standby — never routed proactively, `--allow-standby` only on explicit
human order.

## Why every coder shares one family

The watcher enforces a ternary rule: the reviewer's **group** must differ from
the coder's, and it reads a single `REV_AGENT` out of
`.herdr/config/reviewer.json`. With two coder families one reviewer cannot be
cross-group to both, and same-family review would be worthless anyway. So all
coders are agy and the one reviewer is opencode — cross-group *and*
cross-family for every lane.

## Config

- `.herdr/config/reviewer.json` — reviewer kind/model/agent + default test command
- `.herdr/config/agent-freeze.json` — single-agent freeze registry
- `.herdr/config/fleet.env` — `FLEET_WT_ROOT` (machine-local, gitignored)
- `.herdr/lanes/groups.json` — groups, families, roles, thresholds

## Lane placement

`$FLEET_WT_ROOT/fleet-<repo-slug>-<agent>`
(=`/Users/ggdayup/.herdr/worktrees/fleet-skillsgate-<agent>`).

Worker-side scripts live in `.herdr/scripts/` (tracked, so every worktree has
them): `fleet-done`, `fleet-heartbeat`, `fleet-checkpoint`, `fleet-land.sh`.
Lead-side scripts (`fleet-dispatch.sh`, `watcher.sh`, `fleet-lib.sh`, …) come
from the herdr-run skill and are not duplicated here.
