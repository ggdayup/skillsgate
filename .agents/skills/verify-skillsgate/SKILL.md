---
name: verify-skillsgate
description: Drive, inspect, and verify SkillsGate desktop app and core sync behavior using accessibility controls and runtime forensics.
---

# Verify SkillsGate

Use this skill to drive the real SkillsGate desktop app, execute user-facing workflows, and capture verifiable proof of correct behavior.

## Launch

Start SkillsGate for verification using the helper script:

```bash
.agents/skills/verify-skillsgate/scripts/control-skillsgate.py launch
```

Ready detection:
- The script queries the desktop window server using `cua-driver`.
- The instance is ready when a window titled `SkillsGate` appears and exposes an accessible AXWebArea.
- The script records the launch PID to `/tmp/skillsgate-verify.pid` so cleanup tracks only verification-owned processes.

Alternative direct launch for packaged app:

```bash
open -a /Applications/SkillsGate.app
```

For CLI core engine verification:

```bash
npm run test -w packages/cli
```

## Doctor

Run the read-only health check before driving any feature:

```bash
.agents/skills/verify-skillsgate/scripts/control-skillsgate.py doctor
```

The check verifies:
1. `cua-driver` accessibility driver binary is present and reachable.
2. `/Applications/SkillsGate.app` exists and reads the current release version from `Info.plist`.
3. SkillsGate process is active and WindowServer owns an open window titled `SkillsGate`.
4. The window accessibility tree responds with non-zero actionable elements.

If `status` is not `HEALTHY`, inspect the reported `issues` array before proceeding.

## Drive

Drive the desktop user interface through stable ARIA roles and labels using `control-skillsgate.py`.

### Navigation

Switch primary views using the navigation helper:

```bash
.agents/skills/verify-skillsgate/scripts/control-skillsgate.py nav installed
.agents/skills/verify-skillsgate/scripts/control-skillsgate.py nav core
.agents/skills/verify-skillsgate/scripts/control-skillsgate.py nav discover
.agents/skills/verify-skillsgate/scripts/control-skillsgate.py nav sources
.agents/skills/verify-skillsgate/scripts/control-skillsgate.py nav settings
```

### Inspecting UI state

Query the active window accessibility tree with optional query filters:

```bash
.agents/skills/verify-skillsgate/scripts/control-skillsgate.py snapshot --query "Core skills"
.agents/skills/verify-skillsgate/scripts/control-skillsgate.py snapshot --query "Claude Code"
```

Save complete tree markdown to disk:

```bash
.agents/skills/verify-skillsgate/scripts/control-skillsgate.py snapshot --out /tmp/skillsgate-tree.md
```

### Direct driver actions

For low-level accessibility actions, invoke `cua-driver` directly with the PID and Window ID from `doctor`:

```bash
cua-driver call click '{"pid": <PID>, "window_id": <WINDOW_ID>, "element_token": "<TOKEN>"}'
cua-driver call type_text '{"pid": <PID>, "text": "my-search-term"}'
cua-driver call press_key '{"key": "Return"}'
```

## Evidence

Capture verification artifacts into `.agents/skills/verify-skillsgate/artifacts/<feature-name>/`:

```bash
.agents/skills/verify-skillsgate/scripts/control-skillsgate.py capture-proof <feature-name>
```

Artifact standards:
- UI proof captures both an ARIA tree snapshot (`snapshot.aria.txt`) and a full window screenshot (`view.png`).
- Proof artifacts reside under `.agents/skills/verify-skillsgate/artifacts/`.
- Filesystem state must be verified alongside UI state. Inspect symlink paths in `~/.agents/skills` and target agent directories.
- SQLite state can be verified by querying `~/Library/Application Support/@skillsgate/desktop/skillsgate.db`.

## Cleanup

Tear down instances created by the verification harness:

```bash
.agents/skills/verify-skillsgate/scripts/control-skillsgate.py quit
```

Cleanup rules:
- Only processes whose PID matches `/tmp/skillsgate-verify.pid` will be terminated.
- Pre-existing user sessions will not be killed unless `--force` is provided.
- Cleanup never deletes files in `artifacts/`. Proof files survive teardown.
- Ephemeral test scratch files under `/tmp/` are removed.

## Helpers

The verification harness provides the executable helper script:

- Path: `.agents/skills/verify-skillsgate/scripts/control-skillsgate.py`
- Executable flag: ensure `chmod +x .agents/skills/verify-skillsgate/scripts/control-skillsgate.py` is set.
- Supported verbs:
  - `doctor`: inspects app and driver readiness.
  - `launch`: starts SkillsGate and waits for ready window.
  - `nav <tab>`: switches view to installed, core, discover, sources, or settings.
  - `snapshot`: dumps accessibility tree and optional screenshot.
  - `capture-proof <feature>`: generates standard proof bundle in artifacts folder.
  - `quit`: cleanly shuts down verification instance.
