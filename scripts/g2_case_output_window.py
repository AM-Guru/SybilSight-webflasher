#!/usr/bin/env python3
"""Temporarily disable stock Case output, then restore it automatically.

This sends only the stock destination-2 output command 0x3F. It does not
transmit to a temple, alter Case flash, or assert an Apollo reset.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
from case_native_task_flash.build import CASE_SERIAL
from case_sbl_discovery.run import preflight
from g2_case_pogo_flasher import _open_case_console, _drain_case_console
from g2_pogo_protocol import add_ordinary_checksum, build_response

OUTPUT_OFF = bytes.fromhex("5aa57f05") + add_ordinary_checksum(bytes.fromhex("3f00020000"))
OUTPUT_ON = bytes.fromhex("5aa57f05") + add_ordinary_checksum(bytes.fromhex("3f00020001"))
ACK = build_response(0x3F, 0)
assert OUTPUT_OFF.hex() == "5aa57f053f00020000c4"
assert OUTPUT_ON.hex() == "5aa57f053f00020001c5"


def status(port, seconds: float = 1.2) -> bytes:
    command = b"DEA3\n"
    if port.write(command) != len(command):
        raise IOError("truncated read-only Case status request")
    port.flush()
    return _drain_case_console(port, seconds)


def output_state(raw: bytes) -> int | None:
    # Stock 0x08007F2C selects the status prefix from output flag 0x20000891.
    # The chEn field instead reads 0x20000892 and does not prove this flag.
    values = re.findall(rb"(\*{6}|x{6}) B200 vol:", raw)
    return (1 if values[-1] == b"******" else 0) if values else None


def charger_state(raw: bytes) -> int | None:
    values = re.findall(rb"\bchEn:(\d+)\b", raw)
    return int(values[-1]) if values else None


def send_output(port, packet: bytes, expected: int) -> tuple[bytes, bool]:
    if packet not in (OUTPUT_OFF, OUTPUT_ON):
        raise ValueError("packet outside fixed Case output allowlist")
    if port.write(packet) != len(packet):
        raise IOError("truncated Case output command")
    port.flush()
    raw = bytearray(_drain_case_console(port, 1.5))
    for _ in range(4):
        raw.extend(status(port))
        if ACK in raw and output_state(raw) == expected:
            break
    return bytes(raw), ACK in raw and output_state(raw) == expected


def run(device: str, output: Path, hold_seconds: float) -> dict[str, object]:
    if output.exists():
        raise ValueError("output audit path must be fresh")
    if not 15 <= hold_seconds <= 45:
        raise ValueError("hold interval outside bounded 15-45 second window")
    output.parent.mkdir(parents=True, exist_ok=True)
    audit: dict[str, object] = {
        "operation": "stock-case-bounded-output-disable-window",
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "caseSerial": CASE_SERIAL,
        "offRequestHex": OUTPUT_OFF.hex(),
        "onRequestHex": OUTPUT_ON.hex(),
        "holdSeconds": hold_seconds,
        "templeFirmwareImageBytesSent": 0,
        "templeCommandsSent": 0,
        "caseFlashBytesWritten": 0,
        "physicalApolloResetVerified": False,
        "physicalCaseOutputVoltageVerified": False,
        "outcome": "not-started",
    }
    port = None
    off_attempted = False
    try:
        before = preflight(device, CASE_SERIAL, "left")
        audit["preflight"] = {k: before[k] for k in (
            "caseSerial", "case_version", "left_present", "right_present", "ota_glasses"
        )}
        port = _open_case_console(device)
        # The stock banner/status task often emits the detailed chEn line a
        # few seconds after USB opens; sample that full interval before writes.
        initial = _drain_case_console(port, 3.0) + status(port, 3.0)
        audit["initialOutputEnabled"] = output_state(initial)
        if audit["initialOutputEnabled"] != 1:
            raise ValueError("Case output must be enabled before this experiment")
        off_attempted = True
        off_raw, off_ok = send_output(port, OUTPUT_OFF, 0)
        output.with_suffix(".off.bin").write_bytes(off_raw)
        audit["offAcknowledgedAndFlagDisabled"] = off_ok
        audit["offOutputFlag"] = output_state(off_raw)
        audit["offChargerFlag"] = charger_state(off_raw)
        audit["offCaptureSha256"] = hashlib.sha256(off_raw).hexdigest()
        if not off_ok:
            raise ValueError("Case did not prove output-disable flag")
        print("OUTPUT_FLAG_DISABLED: bounded Bluetooth observation window is open", flush=True)
        deadline = time.monotonic() + hold_seconds
        while time.monotonic() < deadline:
            time.sleep(min(1, deadline - time.monotonic()))
        audit["outcome"] = "output-window-complete"
    except (Exception, KeyboardInterrupt) as error:
        audit["error"] = f"{type(error).__name__}: {error}"
        audit["outcome"] = "failed-closed"
    finally:
        if off_attempted:
            try:
                if port is None or not port.is_open:
                    port = _open_case_console(device)
                on_raw, on_ok = send_output(port, OUTPUT_ON, 1)
                output.with_suffix(".on.bin").write_bytes(on_raw)
                audit["onAcknowledgedAndFlagEnabled"] = on_ok
                audit["onOutputFlag"] = output_state(on_raw)
                audit["onChargerFlag"] = charger_state(on_raw)
                audit["onCaptureSha256"] = hashlib.sha256(on_raw).hexdigest()
                if not on_ok:
                    audit["outcome"] = "output-restore-unverified"
            except Exception as error:
                audit["onError"] = f"{type(error).__name__}: {error}"
                audit["outcome"] = "output-restore-unverified"
        if port is not None:
            port.close()
        audit["usbPortClosed"] = port is None or not port.is_open
        try:
            after = preflight(device, CASE_SERIAL, "left")
            audit["postflight"] = {k: after[k] for k in (
                "caseSerial", "case_version", "left_present", "right_present", "ota_glasses"
            )}
        except Exception as error:
            audit["postflightError"] = f"{type(error).__name__}: {error}"
            audit["outcome"] = "postflight-unverified"
        audit["finishedAt"] = datetime.now(timezone.utc).isoformat()
        output.write_text(json.dumps(audit, indent=2) + "\n")
    return audit


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--hold-seconds", type=float, default=30)
    parser.add_argument("--execute-stock-output-window", action="store_true", required=True)
    args = parser.parse_args()
    report = run(args.device, args.output, args.hold_seconds)
    print(json.dumps(report, indent=2))
    return 0 if report["outcome"] == "output-window-complete" else 2


if __name__ == "__main__":
    raise SystemExit(main())
