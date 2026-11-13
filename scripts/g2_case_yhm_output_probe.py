#!/usr/bin/env python3
"""Observe stock YHM2510 registers across a bounded Case output-off window.

DEAA reads the Case's YHM2510 hardware registers and cached shadow. The only
state-changing frames are fixed stock 0x3F output off/on, with on in cleanup.
No temple command, Case flash write, ROM-loader jump, or SRAM payload is used.
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
from g2_case_output_window import OUTPUT_OFF, OUTPUT_ON, output_state, send_output, status
from g2_case_pogo_flasher import _open_case_console, _drain_case_console


def parse_yhm(raw: bytes) -> dict[str, object]:
    """Parse the last complete live/cache DEAA pair from noisy Case logs."""
    # The first line is eight YHM2510 bus reads; the second prints its cache.
    # Stock printf uses %x without zero padding, and logs may interleave.
    hardware = []
    shadow = []
    for line in raw.splitlines():
        line = line.strip()
        if line.startswith(b"2510: 0x00-0x07:"):
            values = re.findall(rb"\b[0-9a-fA-F]{1,2}\b", line.split(b":", 2)[-1])
            if len(values) == 8:
                shadow.append(bytes(int(v, 16) for v in values))
        elif line.startswith(b"0x00-0x07:"):
            values = re.findall(rb"\b[0-9a-fA-F]{1,2}\b", line.split(b":", 1)[-1])
            if len(values) == 8:
                hardware.append(bytes(int(v, 16) for v in values))
    if not hardware or not shadow:
        raise ValueError("DEAA did not return complete live and cached YHM registers")
    return {"hardwareHex": hardware[-1].hex(), "shadowHex": shadow[-1].hex(),
            "hardwareReg3": hardware[-1][3], "hardwareReg4": hardware[-1][4],
            "shadowReg3": shadow[-1][3], "shadowReg4": shadow[-1][4]}


def read_yhm(port, output: Path, label: str) -> dict[str, object]:
    packet = b"DEAA\n"
    if port.write(packet) != len(packet):
        raise IOError("truncated stock read-only YHM query")
    port.flush()
    raw = _drain_case_console(port, 2.5)
    output.with_name(f"{output.stem}-{label}.bin").write_bytes(raw)
    result = parse_yhm(raw)
    result["outputFlagInSameCapture"] = output_state(raw)
    result["captureSha256"] = hashlib.sha256(raw).hexdigest()
    result["captureBytes"] = len(raw)
    return result


def run(device: str, output: Path, settle_seconds: float) -> dict[str, object]:
    if output.exists():
        raise ValueError("audit path must be fresh")
    if not 5 <= settle_seconds <= 15:
        raise ValueError("settle interval outside bounded 5-15 second range")
    output.parent.mkdir(parents=True, exist_ok=True)
    audit: dict[str, object] = {
        "operation": "stock-case-output-yhm-in-situ-readback",
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "caseSerial": CASE_SERIAL,
        "settleSeconds": settle_seconds,
        "readCommand": "DEAA",
        "offRequestHex": OUTPUT_OFF.hex(),
        "onRequestHex": OUTPUT_ON.hex(),
        "templeCommandsSent": 0,
        "templeFirmwareImageBytesSent": 0,
        "caseFlashBytesWritten": 0,
        "sramPayloadUploaded": False,
        "physicalPogoVoltageMeasured": False,
        "apolloResetVerified": False,
        "outcome": "not-started",
    }
    port = None
    off_attempted = False
    try:
        before = preflight(device, CASE_SERIAL, "left")
        audit["preflight"] = {k: before[k] for k in (
            "caseSerial", "case_version", "left_present", "right_present", "ota_glasses")}
        port = _open_case_console(device)
        initial = _drain_case_console(port, 3.0) + status(port, 3.0)
        if output_state(initial) != 1:
            raise ValueError("Case output flag must start enabled")
        audit["before"] = read_yhm(port, output, "before")
        off_attempted = True
        off_raw, off_ok = send_output(port, OUTPUT_OFF, 0)
        audit["offAcknowledgedAndFlagDisabled"] = off_ok
        audit["offCaptureSha256"] = hashlib.sha256(off_raw).hexdigest()
        if not off_ok:
            raise ValueError("Case output-off was not acknowledged and observed")
        time.sleep(settle_seconds)
        audit["off"] = read_yhm(port, output, "off")
        if audit["off"]["outputFlagInSameCapture"] != 0:
            raise ValueError("DEAA readback was not captured under output flag 0")
        late_status = status(port, 2.0)
        output.with_name(f"{output.stem}-off-late-status.bin").write_bytes(late_status)
        audit["offOutputFlagAfterRead"] = output_state(late_status)
        audit["offLateStatusSha256"] = hashlib.sha256(late_status).hexdigest()
        audit["outcome"] = "off-yhm-measured"
    except (Exception, KeyboardInterrupt) as error:
        audit["error"] = f"{type(error).__name__}: {error}"
        audit["outcome"] = "failed-closed"
    finally:
        if off_attempted:
            try:
                if port is None or not port.is_open:
                    port = _open_case_console(device)
                on_raw, on_ok = send_output(port, OUTPUT_ON, 1)
                audit["onAcknowledgedAndFlagEnabled"] = on_ok
                audit["onCaptureSha256"] = hashlib.sha256(on_raw).hexdigest()
                if not on_ok:
                    audit["outcome"] = "output-restore-unverified"
                else:
                    time.sleep(settle_seconds)
                    audit["after"] = read_yhm(port, output, "after")
                    late_status = status(port, 2.0)
                    output.with_name(f"{output.stem}-on-late-status.bin").write_bytes(late_status)
                    audit["onOutputFlagAfterRead"] = output_state(late_status)
                    audit["onLateStatusSha256"] = hashlib.sha256(late_status).hexdigest()
                    if audit["after"]["outputFlagInSameCapture"] != 1 or audit["onOutputFlagAfterRead"] != 1:
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
                "caseSerial", "case_version", "left_present", "right_present", "ota_glasses")}
        except Exception as error:
            audit["postflightError"] = f"{type(error).__name__}: {error}"
            audit["outcome"] = "postflight-unverified"
        audit["finishedAt"] = datetime.now(timezone.utc).isoformat()
        output.write_text(json.dumps(audit, indent=2) + "\n")
    return audit


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--settle-seconds", type=float, default=8)
    parser.add_argument("--execute-stock-output-yhm-probe", action="store_true", required=True)
    args = parser.parse_args()
    result = run(args.device, args.output, args.settle_seconds)
    print(json.dumps(result, indent=2))
    return 0 if result["outcome"] == "off-yhm-measured" else 2


if __name__ == "__main__":
    raise SystemExit(main())
