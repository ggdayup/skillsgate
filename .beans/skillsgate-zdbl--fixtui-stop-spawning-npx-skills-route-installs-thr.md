---
# skillsgate-zdbl
title: 'fix(tui): stop spawning npx skills, route installs through SkillsGate'
status: in-progress
type: bug
priority: normal
created_at: 2026-09-29T11:27:28Z
updated_at: 2026-09-30T00:03:23Z
---

ADR-0008 states the invariant that install sources are parsed, never executed. The desktop paste path honours it; the TUI does not.

packages/tui/src/data/use-skill-actions.ts:515 runs `npx skills add ${source} --all -y` through execAsync (call site :143) for GitHub sources. That executes untrusted text as a child process, pulls from the npm registry at run time, and bypasses SkillsGate's installer — so no provenance is recorded and no agent fan-out happens.

## Checklist
- [ ] GitHub/owner-repo installs go through the shared installer
- [ ] Remove the execAsync npx path
- [ ] Behaviour on failure is no worse than today (clear error, no silent partial install)
- [ ] Typecheck passes
