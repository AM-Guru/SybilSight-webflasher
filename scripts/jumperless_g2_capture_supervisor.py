#!/usr/bin/env python3
"""Route, capture one stock Case reset, and restore Jumperless routes.

Requires a freshly generated guarded route/restore pair and a fresh physical
qualification. The Case-to-glasses virtual path, if selected in the plan, is
resistive and gives positive signal evidence only.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.jumperless_reset_audio_capture import (
    find_exact_audio_device, record_one, validate_qualification,
)

ROOT = Path(__file__).resolve().parents[1]
BOARD_HELPER = ROOT / "work/usb-stock-recovery-20261104/jumperless/jumperless_host_reference.py"


def run_board_script(board_port: str, script: Path, marker: str, route: str) -> dict:
    result = subprocess.run(
        [sys.executable, str(BOARD_HELPER),
         "--port", board_port, "exec", "--file", str(script), "--timeout", "15"],
        capture_output=True, text=True, timeout=25, check=False,
    )
    payload = None
    for line in result.stdout.splitlines():
        if line.startswith(marker):
            payload = json.loads(line[len(marker):])
    reply = {"exitCode": result.returncode, "stdout": result.stdout,
             "stderr": result.stderr, "payload": payload}
    if result.returncode != 0 or not isinstance(payload, dict) or payload.get("route") != route:
        raise RuntimeError(f"Jumperless {script.name} failed: {reply}")
    return reply


def supervise(board_port: str, case_port: str, route: str, qualifier: Path,
              route_dir: Path, output: Path) -> dict:
    if output.exists():
        raise ValueError("supervisor output directory must be fresh")
    if not board_port.endswith("JLV5port5") or not Path(board_port).exists():
        raise ValueError("Jumperless raw REPL port is unavailable")
    data = json.loads(qualifier.read_text())
    validate_qualification(data, route, datetime.now(timezone.utc))
    find_exact_audio_device()
    route_script = route_dir / "route-device.py"
    restore_script = route_dir / "restore-device.py"
    if not route_script.is_file() or not restore_script.is_file():
        raise ValueError("guarded Jumperless route and restore scripts missing")
    output.mkdir(parents=True)
    report: dict = {
        "operation": "guarded-jumperless-route-case-reset-capture-restore",
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "route": route,
        "casePort": case_port,
        "boardPort": board_port,
        "routeScriptSha256": hashlib.sha256(route_script.read_bytes()).hexdigest(),
        "restoreScriptSha256": hashlib.sha256(restore_script.read_bytes()).hexdigest(),
        "boardRouteAttempted": False,
        "caseResetCommandsAttempted": 0,
        "boardRestoreAttempted": False,
        "boardRestored": False,
        "outcome": "not-started",
    }
    try:
        report["boardRouteAttempted"] = True
        report["routeReply"] = run_board_script(board_port, route_script, "G2JL_ROUTED=", route)
        report["capture"] = record_one(case_port, output / "capture", route, qualifier)
        report["caseResetCommandsAttempted"] = report["capture"]["resetCommandsAttempted"]
        report["outcome"] = report["capture"]["outcome"]
    except (Exception, KeyboardInterrupt) as error:
        report["error"] = f"{type(error).__name__}: {error}"
        report["outcome"] = "failed-before-confirmed-capture"
    finally:
        if report["boardRouteAttempted"]:
            report["boardRestoreAttempted"] = True
            try:
                report["restoreReply"] = run_board_script(
                    board_port, restore_script, "G2JL_RESTORED=", route
                )
                report["boardRestored"] = True
            except Exception as error:
                report["restoreError"] = f"{type(error).__name__}: {error}"
                report["outcome"] = "board-restore-unverified"
        report["finishedAt"] = datetime.now(timezone.utc).isoformat()
        (output / "supervisor.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--board-port", default="/dev/cu.usbmodemJLV5port5")
    parser.add_argument("--case-port", default="/dev/cu.usbserial-210")
    parser.add_argument("--route", required=True, choices=("left", "right"))
    parser.add_argument("--qualification", required=True, type=Path)
    parser.add_argument("--route-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    report = supervise(args.board_port, args.case_port, args.route,
                       args.qualification, args.route_dir, args.output)
    print(json.dumps({k: report.get(k) for k in (
        "outcome", "caseResetCommandsAttempted", "boardRestored", "error", "restoreError"
    )}, indent=2))
    return 0 if report["outcome"] == "captured-case-reset-confirmed" and report["boardRestored"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
