---
# skillsgate-9bb6
title: 'feat: configure codebuddy and workbuddy-ai directories and rebuild desktop app'
status: completed
type: task
priority: high
created_at: 2026-09-11T14:07:26Z
updated_at: 2026-09-11T14:08:01Z
---

Configure /Users/ggdayup/.codebuddy and /Users/ggdayup/.workbuddy-ai in scan.customPaths, ensure workbuddy-ai skills directory links to canonical store, update desktop database cache, and restart SkillsGate.app with latest build.



## Summary of Changes
- Added /Users/ggdayup/.codebuddy and /Users/ggdayup/.workbuddy-ai to SkillsGate Desktop custom scan paths (scan.customPaths).
- Backed up /Users/ggdayup/.workbuddy-ai/skills to skills.bak and linked it to ~/.agents/skills (matching the setup of .codebuddy/skills).
- Repackaged SkillsGate.app with latest Electron bundle and restarted the application.
- Successfully verified that both CodeBuddy CN (CB) and WorkBuddy AI (WBA) are active and detecting all 45 installed skills.
