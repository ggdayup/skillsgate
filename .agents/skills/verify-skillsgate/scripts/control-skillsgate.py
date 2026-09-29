#!/usr/bin/env python3
import argparse
import json
import os
import plistlib
import shutil
import subprocess
import sys
import time
from pathlib import Path

DEFAULT_APP_PATH = Path("/Applications/SkillsGate.app")
PID_FILE = Path("/tmp/skillsgate-verify.pid")

def get_driver_bin() -> str:
    found = shutil.which("cua-driver")
    if found:
        return found
    local_bin = Path.home() / ".local/bin/cua-driver"
    if local_bin.exists():
        return str(local_bin)
    raise RuntimeError("cua-driver binary not found in PATH or ~/.local/bin/cua-driver")

def run_driver_tool(tool_name: str, args: dict) -> dict:
    driver = get_driver_bin()
    cmd = [driver, "call", tool_name, json.dumps(args)]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        raise RuntimeError(f"cua-driver {tool_name} failed (code {proc.returncode}): {proc.stderr.strip() or proc.stdout.strip()}")
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as err:
        raise RuntimeError(f"Invalid JSON from cua-driver {tool_name}: {proc.stdout}") from err

def find_skillsgate_window() -> tuple[int, int] | None:
    data = run_driver_tool("get_accessibility_tree", {})
    windows = data.get("windows", [])
    for win in windows:
        if win.get("app_name") == "SkillsGate" and win.get("title") == "SkillsGate":
            return win.get("pid"), win.get("window_id")
    for win in windows:
        if win.get("app_name") == "SkillsGate":
            return win.get("pid"), win.get("window_id")
    return None

def get_installed_version() -> str:
    plist_path = DEFAULT_APP_PATH / "Contents/Info.plist"
    if plist_path.exists():
        try:
            with open(plist_path, "rb") as f:
                info = plistlib.load(f)
                return info.get("CFBundleShortVersionString", "unknown")
        except Exception:
            pass
    return "unknown"

def cmd_doctor(_args: argparse.Namespace) -> int:
    issues = []
    driver_ok = False
    try:
        driver_path = get_driver_bin()
        driver_ok = True
    except Exception as exc:
        issues.append(str(exc))
        driver_path = "missing"

    app_ok = DEFAULT_APP_PATH.exists()
    version = get_installed_version()
    if not app_ok:
        issues.append(f"App missing at {DEFAULT_APP_PATH}")

    win = find_skillsgate_window()
    ax_ok = False
    elements_count = 0
    if win:
        pid, window_id = win
        try:
            state = run_driver_tool("get_window_state", {
                "pid": pid,
                "window_id": window_id,
                "include_screenshot": False,
                "max_depth": 4,
            })
            elements_count = state.get("returned_element_count", 0)
            ax_ok = elements_count > 0
        except Exception as exc:
            issues.append(f"AX inspection failed: {exc}")
    else:
        issues.append("SkillsGate window is not running")

    report = {
        "status": "HEALTHY" if (driver_ok and app_ok and win and ax_ok) else "DEGRADED",
        "cua_driver": driver_path,
        "app_installed": app_ok,
        "app_version": version,
        "running_pid": win[0] if win else None,
        "window_id": win[1] if win else None,
        "ax_responsive": ax_ok,
        "elements_visible": elements_count,
        "issues": issues,
    }
    print(json.dumps(report, indent=2))
    return 0 if report["status"] == "HEALTHY" else 1

def cmd_launch(_args: argparse.Namespace) -> int:
    win = find_skillsgate_window()
    if win:
        print(f"SkillsGate already running (pid={win[0]}, window_id={win[1]})")
        return 0

    if not DEFAULT_APP_PATH.exists():
        sys.stderr.write(f"Error: {DEFAULT_APP_PATH} does not exist\n")
        return 1

    subprocess.run(["open", "-a", str(DEFAULT_APP_PATH)], check=True)
    deadline = time.time() + 10.0
    while time.time() < deadline:
        time.sleep(0.5)
        win = find_skillsgate_window()
        if win:
            PID_FILE.write_text(str(win[0]))
            print(f"SkillsGate ready (pid={win[0]}, window_id={win[1]})")
            return 0

    sys.stderr.write("Timeout waiting for SkillsGate window\n")
    return 1

def cmd_nav(args: argparse.Namespace) -> int:
    target_tab = args.tab.strip().lower()
    tab_names = {
        "installed": "Installed",
        "core": "Core",
        "discover": "Discover",
        "servers": "Servers",
        "sources": "Sources",
        "settings": "Settings",
    }
    if target_tab not in tab_names:
        sys.stderr.write(f"Unknown tab '{target_tab}'. Allowed: {list(tab_names.keys())}\n")
        return 1

    target_label = tab_names[target_tab]
    win = find_skillsgate_window()
    if not win:
        sys.stderr.write("SkillsGate is not running. Run launch first.\n")
        return 1
    pid, window_id = win

    state = run_driver_tool("get_window_state", {
        "pid": pid,
        "window_id": window_id,
        "include_screenshot": False,
        "max_depth": 5,
    })
    elements = state.get("elements", [])
    link = next((e for e in elements if e.get("role") == "AXLink" and e.get("label") == target_label), None)
    if not link:
        sys.stderr.write(f"Navigation link '{target_label}' not found in current UI state\n")
        return 1

    token = link["element_token"]
    run_driver_tool("click", {
        "pid": pid,
        "window_id": window_id,
        "element_token": token,
    })

    time.sleep(0.6)
    new_state = run_driver_tool("get_window_state", {
        "pid": pid,
        "window_id": window_id,
        "include_screenshot": False,
        "max_depth": 5,
    })
    new_elements = new_state.get("elements", [])
    heading = next((e for e in new_elements if e.get("role") == "AXHeading"), None)
    heading_text = heading.get("label") if heading else "None"
    print(f"Navigated to '{target_label}'. Active view heading: {heading_text}")
    return 0

def cmd_snapshot(args: argparse.Namespace) -> int:
    win = find_skillsgate_window()
    if not win:
        sys.stderr.write("SkillsGate is not running.\n")
        return 1
    pid, window_id = win

    call_args = {
        "pid": pid,
        "window_id": window_id,
        "include_accessibility_tree": True,
        "include_screenshot": bool(args.screenshot),
        "max_depth": args.max_depth,
    }
    if args.screenshot:
        call_args["screenshot_out_file"] = str(Path(args.screenshot).resolve())
    if args.query:
        call_args["query"] = args.query

    state = run_driver_tool("get_window_state", call_args)
    tree_md = state.get("tree_markdown", "")
    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(tree_md, encoding="utf-8")
        print(f"Wrote accessibility snapshot to {out_path}")
    else:
        print(tree_md)

    if args.screenshot:
        print(f"Saved screenshot to {args.screenshot}")
    return 0

def cmd_capture_proof(args: argparse.Namespace) -> int:
    feature = args.feature.strip()
    out_dir = Path(args.out_dir) / feature if args.out_dir else Path(".agents/skills/verify-skillsgate/artifacts") / feature
    out_dir.mkdir(parents=True, exist_ok=True)

    win = find_skillsgate_window()
    if not win:
        sys.stderr.write("SkillsGate is not running.\n")
        return 1
    pid, window_id = win

    shot_path = out_dir / "view.png"
    tree_path = out_dir / "snapshot.aria.txt"

    state = run_driver_tool("get_window_state", {
        "pid": pid,
        "window_id": window_id,
        "include_accessibility_tree": True,
        "include_screenshot": True,
        "screenshot_out_file": str(shot_path.resolve()),
        "max_depth": 8,
    })
    tree_path.write_text(state.get("tree_markdown", ""), encoding="utf-8")
    print(f"Captured proof for feature '{feature}':")
    print(f"  ARIA Tree:  {tree_path}")
    print(f"  Screenshot: {shot_path}")
    return 0

def cmd_quit(args: argparse.Namespace) -> int:
    win = find_skillsgate_window()
    if not win:
        print("SkillsGate is not running.")
        return 0
    pid, _ = win

    if not args.force:
        if not PID_FILE.exists():
            print("SkillsGate was not started by this verification harness (no PID file). Use --force to close it.")
            return 0
        recorded_pid = PID_FILE.read_text().strip()
        if recorded_pid != str(pid):
            print("PID does not match recorded launch PID. Use --force to close.")
            return 0

    run_driver_tool("kill_app", {"pid": pid})
    if PID_FILE.exists():
        PID_FILE.unlink()
    print(f"Terminated SkillsGate (pid={pid})")
    return 0

def main() -> int:
    parser = argparse.ArgumentParser(description="SkillsGate Verification & Control Driver")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("doctor", help="Run read-only health checks")
    subparsers.add_parser("launch", help="Launch SkillsGate and wait for ready state")

    nav_parser = subparsers.add_parser("nav", help="Navigate to a specific tab")
    nav_parser.add_argument("tab", help="Tab name: installed, core, discover, sources, settings")

    snap_parser = subparsers.add_parser("snapshot", help="Capture window accessibility tree and optional screenshot")
    snap_parser.add_argument("--out", help="Path to write ARIA tree markdown")
    snap_parser.add_argument("--screenshot", help="Path to write screenshot PNG")
    snap_parser.add_argument("--query", help="Filter tree by query string")
    snap_parser.add_argument("--max-depth", type=int, default=6, help="Max depth of AX tree walk")

    proof_parser = subparsers.add_parser("capture-proof", help="Capture ARIA snapshot and screenshot into artifacts")
    proof_parser.add_argument("feature", help="Feature name (e.g. core-sync, installed-tools)")
    proof_parser.add_argument("--out-dir", help="Output directory override")

    quit_parser = subparsers.add_parser("quit", help="Clean up SkillsGate instance")
    quit_parser.add_argument("--force", action="store_true", help="Force termination even if not launched by harness")

    args = parser.parse_args()
    if args.command == "doctor":
        return cmd_doctor(args)
    if args.command == "launch":
        return cmd_launch(args)
    if args.command == "nav":
        return cmd_nav(args)
    if args.command == "snapshot":
        return cmd_snapshot(args)
    if args.command == "capture-proof":
        return cmd_capture_proof(args)
    if args.command == "quit":
        return cmd_quit(args)
    return 0

if __name__ == "__main__":
    sys.exit(main())
