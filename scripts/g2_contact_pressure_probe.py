#!/usr/bin/env python3
"""Read-only bilateral version probe while both G2 temples remain seated.

The host emits only stock Case diagnostic and fixed temple version requests.
An operator can press the seated temples during the printed ARMED window.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import time

from g2_stock_case_diagnostics import (
    DIAGNOSTICS, VERSION_REQUESTS, check_preflight, decode_versions,
    read_for, send_fixed,
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def run(port, expected_serial: str, output: Path, window_seconds: float) -> dict:
    audit = {
        "operation": "seated-contact-pressure-read-only-version-probe",
        "startedAt": utc_now(), "expectedCaseSerial": expected_serial.upper(),
        "hostPacketsAllowed": [p.hex() for p in (*DIAGNOSTICS, *VERSION_REQUESTS.values())],
        "templeFirmwareImageBytesSent": 0, "caseFlashWrites": 0,
        "operatorPressureNotMeasuredBySoftware": True,
        "queries": [], "outcome": "failed-closed",
    }
    try:
        port.open()
        preflight = bytearray(read_for(port, 6))
        for packet in DIAGNOSTICS:
            send_fixed(port, packet)
            preflight.extend(read_for(port, 1))
        (output / "preflight.bin").write_bytes(preflight)
        audit["preflight"] = check_preflight(bytes(preflight), expected_serial)
        audit["armedAt"] = utc_now()
        print("ARMED SEATED CONTACT PRESSURE CONTROL", flush=True)
        deadline = time.monotonic() + window_seconds
        seen = {"left": False, "right": False}
        for index in range(32):
            if time.monotonic() >= deadline or all(seen.values()):
                break
            side = "left" if index % 2 == 0 else "right"
            discarded = read_for(port, 0.2)
            (output / f"before-{index:02d}-{side}.bin").write_bytes(discarded)
            port.reset_input_buffer()
            sent_at = utc_now()
            packet = VERSION_REQUESTS[side]
            send_fixed(port, packet)
            received = read_for(port, min(3.5, max(0.1, deadline-time.monotonic())))
            (output / f"reply-{index:02d}-{side}.bin").write_bytes(received)
            versions = decode_versions(received)
            seen[side] |= bool(versions)
            audit["queries"].append({
                "index": index, "requestedSide": side, "sentAt": sent_at,
                "replyEndedAt": utc_now(), "requestHex": packet.hex(),
                "capturedBytes": len(received), "checksumValidVersionFrames": versions,
                "receiveHeaderTimeouts": received.count(b"receive header timeout"),
            })
            print(f"QUERY {index:02d} {side} versions={len(versions)}", flush=True)
        audit["outcome"] = (
            "both-version-replies" if all(seen.values()) else
            "partial-version-replies" if any(seen.values()) else "no-version-replies"
        )
        send_fixed(port, DIAGNOSTICS[1])
        postflight = read_for(port, 1.5)
        (output / "postflight.bin").write_bytes(postflight)
        audit["postflightRawBytes"] = len(postflight)
        audit["postflightBothContactsReported"] = bool(re.search(
            rb"GLS_L:1, GLS_R:1", postflight))
    except Exception as error:
        audit["outcome"] = "failed-closed"
        audit["error"] = str(error)
    finally:
        if port.is_open:
            port.close()
        audit["usbPortClosed"] = not port.is_open
        audit["endedAt"] = utc_now()
        (output / "audit.json").write_text(json.dumps(audit, indent=2) + "\n")
    return audit


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", required=True)
    parser.add_argument("--case-serial", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--window-seconds", type=float, default=90.0)
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9A-Fa-f]{24}", args.case_serial):
        parser.error("case serial must contain 24 hexadecimal characters")
    if not 15 <= args.window_seconds <= 120:
        parser.error("window-seconds must be between 15 and 120")
    args.output.mkdir(parents=True, exist_ok=False)
    import serial
    port = serial.Serial()
    port.port, port.baudrate = args.device, 1_000_000
    port.bytesize, port.parity, port.stopbits = (
        serial.EIGHTBITS, serial.PARITY_NONE, serial.STOPBITS_ONE)
    port.timeout, port.write_timeout = 0.1, 1
    port.dtr, port.rts = True, False
    audit = run(port, args.case_serial, args.output, args.window_seconds)
    print(json.dumps({k: audit[k] for k in (
        "outcome", "armedAt", "usbPortClosed", "queries") if k in audit},
        indent=2), flush=True)
    return 0 if audit["outcome"] == "both-version-replies" else 2


if __name__ == "__main__":
    raise SystemExit(main())
