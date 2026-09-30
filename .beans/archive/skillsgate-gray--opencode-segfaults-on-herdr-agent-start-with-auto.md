---
# skillsgate-gray
title: opencode segfaults on herdr agent start with --auto --model
status: scrapped
type: bug
priority: normal
created_at: 2026-09-30T02:34:40Z
updated_at: 2026-09-30T02:35:59Z
---

## Symptom

`herdr agent start --kind opencode` deterministically segfaults at startup when both `--auto` and `--model <X>` are supplied.

- Reproduced with `--model muse-spark` and `--model mimo`.
- Crash reports land in `~/Library/Application Support/opencode/crash/` (sample id base `Ma11381054m5Gz`).

## What was isolated (local-only, no fix yet)

| Invocation | Result |
| --- | --- |
| `--auto --model <X>` | **segfault** |
| `--auto` alone | OK |
| `--model <X>` alone | OK |
| `--pure --auto --model <X>` | **still segfaults** (rules out plugins) |
| `--model muse-spark` + trivial `PONG` prompt | OK |
| `--model muse-spark` + real brief prompt | **segfault** |

Ruled out: pane width (2-col and 120-col both fail), cwd, `NODE_OPTIONS` (empty), registration state, plugin stack.

## Environment

- Bun `1.4.0`, opencode `1.18.30`, macOS/darwin.
- Related, already known: the OpenAI 64-char tool-name limit (see global `AGENTS.md`) bites OpenAI-compatible providers on this stack — worth checking whether the crash path shares a code path with tool-schema construction.

## Working workaround (in use)

Headless run instead of a TUI pane:

```bash
opencode run --auto --pure --model "opencode/muse-spark-1.3-contributor-free"
```

Verified to complete a full multi-file review with no crash.

Two adjacent quirks found while testing `herdr agent start`:

1. The pane input buffer must be flushed first — a killed TUI leaves mouse-mode escapes, producing `zsh: command not found: 20Mopencode`.
2. `herdr` has **no** `agent stop` command (the one in `fleet-land.sh` is a silent no-op); `pane release-agent` requires `--source` and `--agent`.

## Done when

- [ ] Root cause identified from a crash report (JS/Bun stack, not just the signal)
- [ ] `herdr agent start --kind opencode --auto --model <X>` starts without segfaulting
- [ ] The `fleet-done` TUI announcement path works for a reviewer again, so headless fallback is no longer required

## Reasons for Scrapping

Accidental duplicate of `skillsgate-myv9` (the same `beans create` fired twice while parsing the first attempt's output failed). `skillsgate-myv9` carries the full investigation and is the live tracker for this bug.
