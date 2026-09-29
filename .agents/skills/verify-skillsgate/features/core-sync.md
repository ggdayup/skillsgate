# Core skills synchronization

Core skills synchronization manages the central canonical skills directory at `~/.agents/skills` and fans out symlinks into all detected coding agent targets.

## Sub-features

- `core-inspect` displays canonical skill counts, detected tools count, and synchronization status.
- `core-plan` computes the fan-out plan showing missing links, established links, and conflicts.
- `core-preview` generates a dry-run report before applying filesystem changes.
- `core-apply` executes idempotent relative symlink generation across all detected agent directories.

## How to get to it (user POV)

- Choose the `Core` link in the main navigation sidebar.
- Inspect the statistics bar showing Core skills, Tools, and Fully synced metrics.
- Click the `Preview Changes` button to review the synchronization plan.
- Click `Apply Sync` to link canonical skills to agent directories.

## Driving it with control-skillsgate

Preconditions:

- SkillsGate desktop window is active and responsive.
- Run `control-skillsgate doctor` and verify a HEALTHY state.
- Canonical skills exist under `~/.agents/skills`.

- **Navigate to Core view.** Choose the Core tab. Run `.agents/skills/verify-skillsgate/scripts/control-skillsgate.py nav core`. The active view heading displays `Core Skills`.
- **Inspect canonical status.** Verify the statistics banner. Run `.agents/skills/verify-skillsgate/scripts/control-skillsgate.py snapshot --query "Core skills"`. The tree displays the count of canonical skills and the count of detected tools.
- **Inspect tool status.** Review the per-tool fan-out list. Each tool indicates whether it is fully synced or pending updates.
- **Proof.** Capture an ARIA snapshot and a screenshot of the view. Run `.agents/skills/verify-skillsgate/scripts/control-skillsgate.py capture-proof core-sync`. The output directory contains `snapshot.aria.txt` and `view.png`.
- **Filesystem verification.** Verify filesystem integrity. Check that entries in target directories resolve directly to items in `~/.agents/skills`.

## Gotchas

- `~/.agents/skills` is the truth. The directory contents define the core set.
- `~/.agents/.store` is the canonical backend for non-core installs. Do not conflate the two directories.
- Fan-out must never overwrite real directories. Existing non-symlink directories are treated as conflicts and require backup before linking.
- Agents that symlink their entire skills directory to the core directory must report as already linked.
