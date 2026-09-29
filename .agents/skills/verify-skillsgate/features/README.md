# SkillsGate verification map

This directory is the maintained source for verifying user-facing behavior in SkillsGate. Read the index before driving the app, then follow the matching feature file as the execution recipe.

## Baseline preconditions

- SkillsGate desktop app is available at `/Applications/SkillsGate.app`.
- The `cua-driver` CLI is installed and accessible on PATH or at `~/.local/bin/cua-driver`.
- The verification helper script `.agents/skills/verify-skillsgate/scripts/control-skillsgate.py` is executable.
- Run `control-skillsgate doctor` and require a HEALTHY status before driving the app.
- Shared canonical directories exist at `~/.agents/skills`, `~/.agents/.store`, and `~/.agents/.store/repos`.

## Driving conventions

- Start every recipe from the baseline state unless preconditions state otherwise.
- Prefer ARIA link and button roles over coordinates.
- Treat every command as literal. Keep names and flags unchanged.
- Drive navigation and state queries using `.agents/skills/verify-skillsgate/scripts/control-skillsgate.py`.
- Capture both an ARIA snapshot and a screenshot for all UI verification runs.
- Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof requires an ARIA snapshot and a window screenshot.
- Filesystem proof includes directory listings and symlink target resolutions.
- Mutation proof includes a read-only second view of the stored value or target directory.
- Record the feature ID and entry point used with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing user-visible behavior. It then uses exactly four H2 sections in this order:

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with control-skillsgate` starts with `Preconditions` and uses labeled bullets pairing user actions with commands and observable results.
4. `Gotchas` lists traps that waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Installed tools](./installed-tools.md) covers sidebar agent detection, skill counts, search filtering, and library views.
- [Core skills synchronization](./core-sync.md) covers canonical core skills discovery, two-stage preview and apply, and fan-out to detected tools.
- [Discover and install](./discover-install.md) covers search, pasting install commands, bare GitHub URLs, and target selection.
- [Tracked GitHub sources](./tracked-sources.md) covers persistent repo management under `~/.agents/.store/repos`, dirty working tree protection, and updates.
