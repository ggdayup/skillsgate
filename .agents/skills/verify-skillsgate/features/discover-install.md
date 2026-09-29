# Discover and install

Discover and install allows searching community skills, resolving pasted install commands or GitHub URLs, and selecting target tools for installation.

## Sub-features

- `discover-search` queries community skills from registry sources.
- `discover-paste-cmd` parses pasted `npx skills add` command lines into structured source targets.
- `discover-paste-url` parses bare GitHub repository URLs and fetches available skills.
- `discover-local-path` validates absolute or home-relative directory paths for local skill linking.
- `discover-install-target` provisions selected skills into the canonical store and fans out symlinks.

## How to get to it (user POV)

- Choose the `Discover` link in the main navigation sidebar.
- Enter search text into the discovery search box.
- Paste an `npx skills add <source>` command string into the search input.
- Paste a GitHub URL into the search input.
- Click `Install` on a resolved skill card or preview panel.

## Driving it with control-skillsgate

Preconditions:

- SkillsGate desktop window is active and responsive.
- Run `control-skillsgate doctor` and verify a HEALTHY state.

- **Navigate to Discover view.** Choose the Discover tab. Run `.agents/skills/verify-skillsgate/scripts/control-skillsgate.py nav discover`. The active view heading displays `Discover`.
- **Verify search input.** Check that the discovery input field is present. Run `.agents/skills/verify-skillsgate/scripts/control-skillsgate.py snapshot --query "Search"`. The tree displays the search field element.
- **Inspect paste handler affordance.** Paste input is processed entirely in the main process through IPC. No external npx binaries are spawned.
- **Proof.** Capture an ARIA snapshot and a screenshot of the view. Run `.agents/skills/verify-skillsgate/scripts/control-skillsgate.py capture-proof discover-install`. The output directory contains `snapshot.aria.txt` and `view.png`.

## Gotchas

- Pasted install commands are parsed locally and never executed in a shell.
- Relative paths such as `./` and `../` are rejected by the main process because application cwd is not meaningful in the GUI.
- Upstream agent alias flags are mapped automatically to SkillsGate harness identifiers.
