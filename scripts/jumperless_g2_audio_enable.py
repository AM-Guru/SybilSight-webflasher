#!/usr/bin/env python3
"""Enable and verify Jumperless V5 two-channel G2 capture audio.

The audio USB function may re-enumerate and drop its serial port. Success is
decided only by a fresh post-enumeration device inventory, unchanged bridges
and rail settings, and the exact host audio input. This does not route pads
or touch the Case.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.jumperless_reset_audio_capture import find_exact_audio_device

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "work/usb-stock-recovery-20261104/jumperless/jumperless_host_reference.py"
INVENTORY_SCRIPT = ROOT / "scripts/jumperless_g2_audio_inventory.py"
MARKER = "G2JL_AUDIO_INVENTORY="


def run_device_file(board_port: str, script: Path) -> dict:
    try:
        result = subprocess.run(
            [sys.executable, str(HELPER), "--port", board_port, "exec",
             "--file", str(script), "--timeout", "8"],
            capture_output=True, text=True, timeout=15, check=False,
        )
    except subprocess.TimeoutExpired as error:
        return {"exitCode": -1, "stdout": str(error.stdout or ""),
                "stderr": "raw REPL timed out during possible USB re-enumeration"}
    return {"exitCode": result.returncode,
            "stdout": result.stdout, "stderr": result.stderr}


def read_inventory(board_port: str) -> dict:
    reply = run_device_file(board_port, INVENTORY_SCRIPT)
    if reply["exitCode"] != 0:
        raise RuntimeError(f"Jumperless inventory failed: {reply}")
    rows = [json.loads(line[len(MARKER):]) for line in reply["stdout"].splitlines()
            if line.startswith(MARKER)]
    if len(rows) != 1 or rows[0].get("kind") != "read-only-g2-jumperless-audio-inventory":
        raise RuntimeError("Jumperless inventory marker missing or ambiguous")
    return rows[0]


def settings_ready(inventory: dict) -> bool:
    status = inventory.get("usbAudioStatus", {}).get("value", {})
    return (inventory.get("usbAudioIsEnabled") == {"available": True, "value": True}
            and status.get("enabled") is True and status.get("streaming") is False
            and status.get("left") == 0 and status.get("right") == 1
            and status.get("sample_rate") == 16000
            and status.get("full_scale") == 8.0
            and status.get("dc_block") is False)


def build_enable_code(inventory: dict) -> str:
    if inventory.get("usbAudioSetupAvailable") is not True:
        raise ValueError("installed Jumperless lacks usb_audio_setup")
    bridges = inventory.get("bridges")
    rails = inventory.get("dacAndRailSettings")
    if not isinstance(bridges, list) or not isinstance(rails, list) or len(rails) != 4:
        raise ValueError("incomplete Jumperless baseline")
    status = inventory.get("usbAudioStatus", {}).get("value", {})
    if status.get("streaming"):
        raise ValueError("stop existing Jumperless audio stream before configuration")
    return f'''import jumperless as j
_bridges = {bridges!r}
_rails = {rails!r}
if sorted([list(j.get_bridge(i)) for i in range(j.get_num_bridges())]) != sorted(_bridges):
    raise RuntimeError("Jumperless bridges changed before audio setup")
if [j.dac_get(i) for i in range(4)] != _rails:
    raise RuntimeError("Jumperless rails changed before audio setup")
if usb_audio_status().get("streaming"):
    raise RuntimeError("USB audio stream is active")
if not usb_audio_set_rate(16000):
    raise RuntimeError("16 kHz audio rate rejected")
usb_audio_setup(0, 1, 8.0, False)
'''


def configure(board_port: str, output: Path, *, wait_seconds: float = 15.0) -> dict:
    if output.exists():
        raise ValueError("audio enable audit directory must be fresh")
    if not board_port.endswith("JLV5port5") or not Path(board_port).exists():
        raise ValueError("Jumperless raw REPL port unavailable")
    before = read_inventory(board_port)
    code = build_enable_code(before)
    output.mkdir(parents=True)
    (output / "before.json").write_text(json.dumps(before, indent=2) + "\n")
    script = output / "enable-device.py"
    script.write_text(code)
    report = {"operation": "enable-then-verify-jumperless-g2-audio",
              "startedAt": datetime.now(timezone.utc).isoformat(),
              "boardPort": board_port, "audioSetupAttempted": False,
              "bridgesUnchanged": False, "railsUnchanged": False,
              "hostAudioVerified": False, "outcome": "not-started"}
    try:
        if not settings_ready(before):
            report["audioSetupAttempted"] = True
            # A nonzero result can be an expected USB re-enumeration. Only
            # post-enumeration state determines success.
            report["setupReply"] = run_device_file(board_port, script)
        deadline = time.monotonic() + wait_seconds
        last_error = None
        after = None
        while time.monotonic() < deadline:
            try:
                after = read_inventory(board_port)
                break
            except Exception as error:
                last_error = str(error)
                time.sleep(0.5)
        if after is None:
            raise RuntimeError(f"Jumperless did not re-enumerate with a readable REPL: {last_error}")
        (output / "after.json").write_text(json.dumps(after, indent=2) + "\n")
        report["bridgesUnchanged"] = after.get("bridges") == before.get("bridges")
        report["railsUnchanged"] = after.get("dacAndRailSettings") == before.get("dacAndRailSettings")
        if not report["bridgesUnchanged"] or not report["railsUnchanged"]:
            raise RuntimeError("Jumperless routes or rails changed across audio setup")
        if not settings_ready(after):
            raise RuntimeError("post-enumeration Jumperless audio settings do not match capture mode")
        report["hostAudioDeviceIndex"] = find_exact_audio_device()
        report["hostAudioVerified"] = True
        report["outcome"] = "audio-ready"
    except (Exception, KeyboardInterrupt) as error:
        report["error"] = f"{type(error).__name__}: {error}"
        report["outcome"] = "audio-not-verified"
    finally:
        report["finishedAt"] = datetime.now(timezone.utc).isoformat()
        (output / "audit.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--board-port", default="/dev/cu.usbmodemJLV5port5")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    report = configure(args.board_port, args.output)
    print(json.dumps({k: report.get(k) for k in (
        "outcome", "audioSetupAttempted", "bridgesUnchanged",
        "railsUnchanged", "hostAudioVerified", "error"
    )}, indent=2))
    return 0 if report["outcome"] == "audio-ready" else 2


if __name__ == "__main__":
    raise SystemExit(main())
