#!/usr/bin/env python3
"""Bounded stock Case OTA-route probe with automatic mode exit.

The Case's destination-2 0x56 command selects a side for glasses OTA. This
probe uses that stock routing state for a fixed version request only; it does
not send firmware, invoke the ROM loader, or write Case flash.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
from case_native_task_flash.build import CASE_SERIAL
from case_sbl_discovery.run import preflight
from g2_case_pogo_flasher import _open_case_console, _drain_case_console
from g2_pogo_protocol import add_ordinary_checksum
from g2_stock_case_diagnostics import VERSION_REQUESTS, decode_versions


def case_packet(command: bytes) -> bytes:
    return bytes.fromhex("5aa57f") + bytes((len(command),)) + add_ordinary_checksum(command)


ENTRY = {
    "left": case_packet(bytes.fromhex("560002000000")),
    "right": case_packet(bytes.fromhex("560002000001")),
}
EXIT = case_packet(bytes.fromhex("560002000100"))


def send(port, packet: bytes, seconds: float) -> bytes:
    if packet not in (*ENTRY.values(), EXIT, *VERSION_REQUESTS.values(), b"DEA3\n"):
        raise ValueError("packet outside fixed Case route probe allowlist")
    if port.write(packet) != len(packet):
        raise IOError("truncated stock Case command")
    port.flush()
    return _drain_case_console(port, seconds)


def run(device: str, output: Path) -> dict:
    if output.exists():
        raise ValueError("audit path must be fresh")
    output.parent.mkdir(parents=True, exist_ok=True)
    audit = {
        "operation": "stock-case-ota-route-fixed-version-probe",
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "caseSerial": CASE_SERIAL,
        "entryHex": {k: v.hex() for k, v in ENTRY.items()},
        "exitHex": EXIT.hex(),
        "templeFirmwareImageBytesSent": 0,
        "caseFlashBytesWritten": 0,
        "apolloResetVerified": False,
        "routes": [],
        "outcome": "not-started",
    }
    port = None
    entry_attempted = False
    try:
        before = preflight(device, CASE_SERIAL, "left")
        audit["preflight"] = {k: before[k] for k in (
            "caseSerial", "case_version", "left_present", "right_present", "ota_glasses")}
        if not before["left_present"] or not before["right_present"] or before["ota_glasses"] != 0:
            raise ValueError("both seated contacts and inactive glasses OTA required")
        port = _open_case_console(device)
        _drain_case_console(port, 1.0)
        for side in ("left", "right"):
            route = {"side": side, "enteredAt": datetime.now(timezone.utc).isoformat()}
            audit["routes"].append(route)
            try:
                entry_attempted = True
                entry_raw = send(port, ENTRY[side], 2.0)
                route["entryCaptureSha256"] = hashlib.sha256(entry_raw).hexdigest()
                route["entryCaptureBytes"] = len(entry_raw)
                route["entryOtaLog"] = b"Enter GLS_OTA Status" in entry_raw
                route["entryStatus"] = send(port, b"DEA3\n", 1.2).decode("latin1", "replace")[-1500:]
                version_raw = send(port, VERSION_REQUESTS[side], 4.0)
                output.with_name(f"{output.stem}-{side}-version.bin").write_bytes(version_raw)
                route["versionCaptureSha256"] = hashlib.sha256(version_raw).hexdigest()
                route["versionCaptureBytes"] = len(version_raw)
                route["versions"] = decode_versions(version_raw)
                route["receiveHeaderTimeouts"] = version_raw.count(b"receive header timeout")
            finally:
                if entry_attempted:
                    exit_raw = send(port, EXIT, 2.0)
                    route["exitCaptureSha256"] = hashlib.sha256(exit_raw).hexdigest()
                    route["exitCaptureBytes"] = len(exit_raw)
                    route["exitLog"] = b"Exit GLS_OTA Status" in exit_raw
                    route["exitStatus"] = send(port, b"DEA3\n", 1.2).decode("latin1", "replace")[-1500:]
                    entry_attempted = False
        audit["outcome"] = "version-reply" if any(r["versions"] for r in audit["routes"]) else "no-version-reply"
    except (Exception, KeyboardInterrupt) as error:
        audit["error"] = f"{type(error).__name__}: {error}"
        audit["outcome"] = "failed-closed"
    finally:
        if entry_attempted and port is not None and port.is_open:
            try:
                audit["emergencyExitCaptureSha256"] = hashlib.sha256(send(port, EXIT, 2.0)).hexdigest()
            except Exception as error:
                audit["emergencyExitError"] = str(error)
                audit["outcome"] = "exit-unverified"
        if port is not None:
            port.close()
        audit["usbPortClosed"] = port is None or not port.is_open
        try:
            after = preflight(device, CASE_SERIAL, "left")
            audit["postflight"] = {k: after[k] for k in (
                "caseSerial", "case_version", "left_present", "right_present", "ota_glasses")}
            if after["ota_glasses"] != 0:
                audit["outcome"] = "exit-unverified"
        except Exception as error:
            audit["postflightError"] = str(error)
            audit["outcome"] = "postflight-unverified"
        audit["finishedAt"] = datetime.now(timezone.utc).isoformat()
        output.write_text(json.dumps(audit, indent=2) + "\n")
    return audit


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--execute-fixed-ota-route-probe", action="store_true", required=True)
    args = parser.parse_args()
    result = run(args.device, args.output)
    print(json.dumps(result, indent=2))
    return 0 if result["outcome"] == "version-reply" else 2


if __name__ == "__main__":
    raise SystemExit(main())
