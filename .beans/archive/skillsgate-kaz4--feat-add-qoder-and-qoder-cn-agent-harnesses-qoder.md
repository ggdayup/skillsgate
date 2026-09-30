---
# skillsgate-kaz4
title: 'feat: add Qoder and Qoder CN agent harnesses (~/.qoder, ~/.qoder-cn)'
status: completed
type: feature
priority: high
created_at: 2026-09-29T08:38:55Z
updated_at: 2026-09-29T08:49:50Z
---

SkillsGate supports 31 harnesses; Qoder series (Alibaba, global `qoder` and domestic `qoder-cn`) was missing from the Tools list.

Evidence from installed products:
- CLI launcher `~/.qoder/entry/qoder` dispatches to `qodercli` or `Qoder.app` / `Qoder IDE.app` (`com.qoder.ide`, `com.qoder.app`).
- CLI launcher `~/.qoder-cn/entry/qoder-cn` dispatches to `qoderclicn` or `Qoder CN IDE.app` (`com.aliyun.lingma.ide`).
- Global skills dirs: `~/.qoder/skills` and `~/.qoder-cn/skills`.
- Project skills dirs: `.qoder/skills` and `.qoder-cn/skills`.

Checklist:
- [x] Register `qoder` and `qoder-cn` in `packages/cli/src/core/agents.ts`
- [x] Update `AgentType` union in `packages/cli/src/types.ts`
- [x] Add `.qoder-cn/skills` to `PRIORITY_SEARCH_SUFFIXES` in `packages/cli/src/core/skill-discovery.ts`
- [x] Update test count 31 -> 33 and add distinctness tests in `packages/cli/src/core/agents.test.ts`
- [x] Add badges `{ label: "QD", color: "#10B981" }` and `{ label: "QCN", color: "#FF6A00" }` in `packages/tui/src/utils/colors.ts`
- [x] Mirror agent registry and add `.qoder/skills` / `.qoder-cn/skills` to `PROJECT_PROBES` in `apps/desktop/src/main/ipc-handlers.ts`
- [x] Add vector brand marks `qoder.svg` and `qoder-cn.svg` in `apps/desktop/src/renderer/assets/agent-logos/`
- [x] Map logos and display names in `apps/desktop/src/renderer/components/agent-logo.tsx`
- [x] Update `README.md` and `AGENTS.md` (31 -> 33 agents)
- [x] Run test suites and typechecks across CLI, TUI, and Desktop

Verification:
- CLI tests: 20/20 pass (`bun run test`)
- CLI typecheck: clean (`bun x tsc --noEmit`)
- TUI typecheck: clean (`bun x tsc --noEmit`)
- Desktop typecheck: clean (`tsc -p tsconfig.node.json` + `tsc -p tsconfig.web.json`)
- Desktop build: clean (`electron-vite build` bundles `qoder-Df921iMh.svg` and `qoder-cn-DTJQ6MKC.svg`)
- Runtime detection: 33 registered / 26 detected, both `qoder` and `qoder-cn` detected and planned correctly for core sync.

