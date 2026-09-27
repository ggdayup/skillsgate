---
# skillsgate-7tts
title: Add CodeArts Doer harness (~/.codeartsdoer)
status: completed
type: feature
priority: normal
created_at: 2026-09-27T02:41:52Z
updated_at: 2026-09-27T02:51:55Z
---

SkillsGate supports 30 harnesses; CodeArts Doer (Huawei, opencode-based CLI, PLUGIN_ENV=hc) is missing.

Evidence from the installed product:
- launcher `~/.codeartsdoer/installers/codearts` sets SCENARIO=codeartsdoer, KERNEL_CONFIG_DIR=$HOME/.codeartsdoer, PLUGIN_ENV=hc, OPENCODE_CONFIG=$HOME/.codeartsdoer/codearts_cli.json
- bundle resolves the user skills dir as `.<scenario>/skills` on the hc branch (NOT `~/.config/opencode/skills`), i.e. `~/.codeartsdoer/skills` (exists, empty)
- built-in system skills live in `~/.codeartsdoer/cli-data/system/skills` (9 entries) -> must be left alone, same rule as `~/.gemini/<dir>/builtin/skills`
- must NOT share globalSkillsDir with the existing opencode entry

TODO:
- [x] Register codeartsdoer in packages/cli/src/core/agents.ts (globalSkillsDir ~/.codeartsdoer/skills, skillsDir .codeartsdoer/skills, detect via dirExists(~/.codeartsdoer) or codearts on PATH)
- [x] Pin it in agents.test.ts: distinct from opencode, and not the builtin system dir
- [x] AgentName union in packages/cli/src/types.ts
- [x] Badge color in packages/tui/src/utils/colors.ts
- [x] Logo + short code in apps/desktop renderer agent-logo.tsx (and agent list in main/ipc-handlers.ts if mirrored)
- [x] Check skill-discovery.ts for per-agent special casing
- [x] README + AGENTS.md section 2: 30 -> 31 agents
- [x] cd packages/cli && bun run test && typecheck


## Summary of Changes

Registered **CodeArts Doer** as the 31st harness (`codeartsdoer` / `CDR`), taking the
change surface to 9 files + 1 asset:

| File | Change |
| --- | --- |
| `packages/cli/src/core/agents.ts` | registry entry + why-it-isn't-opencode comment |
| `packages/cli/src/types.ts` | `"codeartsdoer"` added to `AgentType` |
| `packages/cli/src/core/skill-discovery.ts` | `.codeartsdoer/skills` project probe |
| `packages/cli/src/core/agents.test.ts` | count 30→31 + dedicated distinctness test |
| `packages/tui/src/utils/colors.ts` | `{ label: "CDR", color: "#E11D48" }` |
| `apps/desktop/src/main/ipc-handlers.ts` | mirrored registry entry (with `shortCode`) + `PROJECT_PROBES` |
| `apps/desktop/src/renderer/components/agent-logo.tsx` | import, `AGENT_LOGOS`, `AGENT_LOGO_FILTERS: "none"`, `DISPLAY_NAME_TO_KEY` |
| `apps/desktop/src/renderer/assets/agent-logos/codeartsdoer.svg` | new tile mark, mercury.svg style |
| `README.md` / `AGENTS.md` | supported-agent list + §2 heading 30→31 + new path-mapping section |

### How the paths were established (not guessed)
- `~/.codeartsdoer/installers/codearts` is a bash launcher exporting
  `SCENARIO=codeartsdoer`, `KERNEL_CONFIG_DIR=$HOME/.codeartsdoer`, `PLUGIN_ENV=hc`.
- `strings` on the 114 MB `installers/bin/codearts` bundle shows the resolver branch:
  `if (env === "hc" || PLUGIN_ENV === "hc") join(home, "." + scenario, "skills")`
  else `join(home, ".config", app, "skills")` → **`~/.codeartsdoer/skills`**, i.e. *not*
  `~/.config/opencode/skills` despite the config declaring
  `"$schema": "https://opencode.ai/config.json"`.
- Built-ins are `~/.codeartsdoer/cli-data/system/skills` (9 skills +
  `SystemSkillStatus.txt`) — treated like `~/.gemini/<dir>/builtin/skills`, never touched.
- Slug needs no `UPSTREAM_AGENT_ALIASES` entry: upstream `skills` uses `codeartsdoer`
  verbatim, so `--agent codeartsdoer` passes through `mapUpstreamAgentName()` unchanged.

### Verification
- CLI: `bun run test` 15/15 (was 14, +1 new), `tsc --noEmit` clean; `skill-sources` 36/36.
- Desktop: `tsconfig.node` + `tsconfig.web` clean; `electron-vite build` succeeds and the
  bundle contains `CodeArts Doer` (renderer + main) and the `#E11D48` mark.
- i18n drift: 199/199, 0 missing / 0 orphaned (display names aren't translation keys).
- Runtime: `detectInstalledAgents()` → 31 registered / 24 detected, `codeartsdoer` present,
  `globalSkillsDir` differs from `opencode`'s `~/.opencode/skills`.
- Read-only `planCoreSync({agentNames:["codeartsdoer"]})` → 61 items, all `link`, targeting
  `~/.codeartsdoer/skills/<name>`. **No live fan-out applied** — that would write 61 symlinks
  into the user's CodeArts config, so it stays the user's action (`skillsgate core sync`).
