# Installed tools

Installed tools displays detected AI coding agent harnesses in the left sidebar and shows skills configured for each harness in the main workspace.

## Sub-features

- `installed-detect` lists all detected coding agent harnesses in the sidebar.
- `installed-counts` shows the count of skills registered for each harness.
- `installed-select` filters the main view by selecting a specific agent tool.
- `installed-search` filters displayed skills in the library view via keyword search.

## How to get to it (user POV)

- Choose the `Installed` link in the main navigation sidebar.
- Click any agent row under the Tools section in the sidebar.
- Type into the search input box in the library toolbar.

## Driving it with control-skillsgate

Preconditions:

- SkillsGate desktop window is active and responsive.
- Run `control-skillsgate doctor` and verify a HEALTHY state.

- **Navigate to Installed view.** Choose the Installed tab. Run `.agents/skills/verify-skillsgate/scripts/control-skillsgate.py nav installed`. The active view heading displays `LIBRARY`.
- **Verify sidebar tool detection.** Query the accessibility tree for agent buttons. Run `.agents/skills/verify-skillsgate/scripts/control-skillsgate.py snapshot --query "Claude Code"`. The tree displays the detected agent button and its associated skill count.
- **Inspect zero-skill tools.** Query tools with zero skills. Empty tools remain visible and actionable as drop targets.
- **Search skills.** Type a query into the search box to filter skills. The rendered card list updates dynamically to show matching skills.
- **Proof.** Capture an ARIA snapshot and a screenshot of the view. Run `.agents/skills/verify-skillsgate/scripts/control-skillsgate.py capture-proof installed-tools`. The output directory contains `snapshot.aria.txt` and `view.png`.

## Gotchas

- Tools with zero skills must remain visible in the sidebar. They serve as drag targets for skill assignments.
- Core is not an agent. `~/.agents/skills` is the shared core source that fans out into individual agent tools.
- Never conflate Gemini CLI with Antigravity products. Gemini CLI uses `~/.gemini/skills` while Antigravity uses `~/.gemini/config/skills`.
