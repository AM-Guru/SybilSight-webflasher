#!/usr/bin/env python3
"""Fixed, read-only version requests via the normal stock G2 case console.

This module deliberately imports no ROM loader, SRAM bridge or image writer.
It cannot establish bootloader entry or authorize a firmware installation.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import time

from g2_pogo_protocol import parse_response

VERSION_REQUESTS = {
    "left": bytes.fromhex("5aa57f0424000000a6"),
    "right": bytes.fromhex("5aa57f0424000100a7"),
}
DIAGNOSTICS = (b"DEA0\n", b"DEA3\n")


def decode_versions(raw: bytes) -> list[dict]:
    found = []
    for offset in range(max(0, len(raw) - 13)):
        frame = raw[offset:offset + 14]
        if frame[:4] != bytes.fromhex("5aa5ff09"):
            continue
        parsed = parse_response(frame)
        if parsed.checksum_valid and parsed.payload[:4] == bytes.fromhex("24010305"):
            found.append({
                "offset": offset, "frameHex": frame.hex(),
                "firmware": ".".join(str(v) for v in parsed.payload[4:8]),
                "hardware": parsed.payload[8],
            })
    return found


def check_preflight(raw: bytes, expected_serial: str) -> dict:
    identities = re.findall(rb"\bB200 ([0-9.]+) ([0-9A-Fa-f]{24})\b", raw)
    versions = re.findall(rb"\bB200 ([0-9.]+)", raw)
    contacts = re.findall(rb"GLS_L:(\d+), GLS_R:(\d+)", raw)
    ota = re.findall(rb"otaGls:(\d+)", raw)
    if not versions or versions[-1] != b"1.2.57":
        raise ValueError("fresh stock case version 1.2.57 is required")
    if (not identities or identities[-1][0] != b"1.2.57"
            or identities[-1][1].upper() != expected_serial.upper().encode()):
        # Do not reset the case just to obtain a banner. A missing identity
        # simply leaves this diagnostic unavailable for the current session.
        raise ValueError("fresh exact case identity is required")
    if not contacts or contacts[-1] != (b"1", b"1"):
        raise ValueError("both temple contacts must be present")
    if not ota or ota[-1] != b"0":
        raise ValueError("fresh inactive temple-OTA evidence is required")
    return {"caseVersion": "1.2.57", "caseSerial": expected_serial.upper(),
            "bothContactsPresent": True, "otaGlasses": 0}


def send_fixed(port, packet: bytes) -> None:
    if packet not in DIAGNOSTICS and packet not in VERSION_REQUESTS.values():
        raise ValueError("packet outside fixed read-only allowlist")
    if port.write(packet) != len(packet):
        raise ValueError("truncated diagnostic request")
    port.flush()


def read_for(port, seconds: float) -> bytes:
    captured = bytearray()
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        captured.extend(port.read(max(1, min(port.in_waiting, 8192))))
        if len(captured) > 1_048_576:
            raise ValueError("case capture exceeded 1 MiB")
    return bytes(captured)


def run_session(port, expected_serial: str, output: Path) -> dict:
    audit = {"startedAt": datetime.now(timezone.utc).isoformat(),
             "operation": "stock-case-read-only-version-diagnostic",
             "firmwareImageBytesSent": 0, "sramPayloadUploaded": False,
             "hostIntentionalResetPulse": False, "physicalTempleResetVerified": False,
             "firmwareWriteAuthorized": False, "queries": []}
    try:
        port.open()
        raw = bytearray(read_for(port, 6))
        for packet in DIAGNOSTICS:
            send_fixed(port, packet)
            raw.extend(read_for(port, 1))
        (output / "preflight.bin").write_bytes(raw)
        audit["preflight"] = check_preflight(bytes(raw), expected_serial)
        for side, packet in VERSION_REQUESTS.items():
            # Keep the discarded interval too: responses carry no side ID.
            (output / f"before-{side}.bin").write_bytes(read_for(port, .5))
            port.reset_input_buffer()
            sent = datetime.now(timezone.utc).isoformat()
            send_fixed(port, packet)
            captured = read_for(port, 4)
            (output / f"{side}.bin").write_bytes(captured)
            audit["queries"].append({
                "requestedSide": side, "sentAt": sent, "requestHex": packet.hex(),
                "capturedBytes": len(captured),
                "checksumValidVersionFrames": decode_versions(captured),
                "receiveHeaderTimeouts": captured.count(b"receive header timeout"),
            })
        replies = [bool(q["checksumValidVersionFrames"]) for q in audit["queries"]]
        audit["outcome"] = ("both-version-replies" if all(replies) else
                            "partial-version-replies" if any(replies) else "no-version-replies")
    except Exception as error:
        audit["outcome"] = "failed-closed"
        audit["error"] = str(error)
    finally:
        if port.is_open:
            port.close()
        audit["usbPortClosed"] = not port.is_open
        audit["endedAt"] = datetime.now(timezone.utc).isoformat()
        (output / "audit.json").write_text(json.dumps(audit, indent=2) + "\n")
    return audit


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", required=True)
    parser.add_argument("--case-serial", required=True)
    parser.add_argument("--output", type=Path, required=True, help="new local evidence directory")
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9A-Fa-f]{24}", args.case_serial):
        parser.error("case serial must contain 24 hexadecimal characters")
    args.output.mkdir(parents=True, exist_ok=False)
    import serial  # Offline parsing and --help need no serial dependency.
    port = serial.Serial()
    port.port, port.baudrate = args.device, 1_000_000
    port.bytesize, port.parity, port.stopbits = serial.EIGHTBITS, serial.PARITY_NONE, serial.STOPBITS_ONE
    port.timeout, port.write_timeout = .1, 1
    port.dtr, port.rts = True, False  # Set before open; no intentional pulse.
    audit = run_session(port, args.case_serial, args.output)
    print(json.dumps(audit, indent=2))
    return 0 if audit["outcome"] == "both-version-replies" else 2


if __name__ == "__main__":
    raise SystemExit(main())
