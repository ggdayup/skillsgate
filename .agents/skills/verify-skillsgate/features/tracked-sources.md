# Tracked GitHub sources

Tracked GitHub sources manages persistent repositories cloned under `~/.agents/.store/repos`, checks working tree cleanliness, and pulls updates across all agent targets.

## Sub-features

- `sources-list` displays all tracked repositories in the persistent repository store.
- `sources-skills` lists individual skills provided by each repository.
- `sources-dirty-guard` detects uncommitted modifications in repository clones and halts destructive pulls.
- `sources-pull` updates the repository clone and propagates refreshed skill files immediately.

## How to get to it (user POV)

- Choose the `Sources` link in the main navigation sidebar.
- Inspect listed repository cards showing owner, repository name, branch, and skill count.
- Click `Check Updates` or `Update` on a repository entry.

## Driving it with control-skillsgate

Preconditions:

- SkillsGate desktop window is active and responsive.
- Run `control-skillsgate doctor` and verify a HEALTHY state.
- The directory `~/.agents/.store/repos` exists on disk.

- **Navigate to Sources view.** Choose the Sources tab. Run `.agents/skills/verify-skillsgate/scripts/control-skillsgate.py nav sources`. The active view heading displays `Sources`.
- **Inspect tracked sources.** Query the accessibility tree for repository names. Run `.agents/skills/verify-skillsgate/scripts/control-skillsgate.py snapshot --query "Sources"`. The tree displays the repository cards and control buttons.
- **Proof.** Capture an ARIA snapshot and a screenshot of the view. Run `.agents/skills/verify-skillsgate/scripts/control-skillsgate.py capture-proof tracked-sources`. The output directory contains `snapshot.aria.txt` and `view.png`.
- **Filesystem verification.** Verify that repository clones reside under `~/.agents/.store/repos` and that skill symlinks point into the corresponding repository subdirectories.

## Gotchas

- Repositories with uncommitted local modifications will refuse git pull updates to protect user work.
- Static skill folders previously copied into canonical storage are backed up to `~/.agents/.backup/` upon persistent repository takeover.
