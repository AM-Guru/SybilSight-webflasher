#!/usr/bin/env python3
"""Run a model-validated, stock-reset/HELLO SRAM probe on one exact G2 case.

This is application-independent discovery, not an Apollo firmware uploader.
This actively emits the vendor PB9 reset train. No erase or image transfer exists.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import time
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from g2_case_rom import open_rom_loader, require_expected_identity, go_sram, restore_application
from g2_sbl_protocol import classify_capture
from case_sbl_reset_early.protocol import parse_ready, ready_bytes
from case_sbl_reset_early.trace import extract
from case_sbl_reset_early.artifacts import inspect_build, decode_result
from case_sbl_discovery.run import preflight, read_range, verify_case_code, write_verified_sram

BASE, RESULT, RESULT_BYTES = 0x20010000, 0x20011a00, 256
CASE_CODE_SHA256 = "773b6d4cfdaf0a5a74a557e3babe8222a0ae813436b76a7437c1096d2c60d677"


def digest(data):
    return hashlib.sha256(data).hexdigest()



def capture_wait_seconds(manifest):
    # RX budget excludes HELLO wire time and native direction changes.
    # Reserve 10 ms/transaction plus five seconds for setup/restoration.
    # This is a conservative host wait, not a physical timing calibration.
    return math.ceil(manifest["nominalReceiveWindowMs"] / 1000 + manifest["attempts"] * (80 / manifest["nominalBaud"] + 0.01) + 5)


def read_ready(port, manifest):
    deadline = time.monotonic() + 3
    port.timeout = 0.1
    capture = bytearray()
    length = len(ready_bytes(manifest))
    while time.monotonic() < deadline and len(capture) < 256:
        capture.extend(port.read(1))
        if len(capture) >= length and capture[-length:4-length] == b"G2R7":
            try:
                return parse_ready(bytes(capture[-length:]), manifest)
            except ValueError:
                pass
    raise ValueError("no CRC-valid post-routing Case readiness acknowledgement")


def launch_and_wait(port, manifest, audit):
    """A lost GO ACK is ambiguous: never launch twice or reset mid-probe."""
    audit["hostCompletionWaitSeconds"] = capture_wait_seconds(manifest)
    launched_at = time.monotonic()
    deadline = launched_at + audit["hostCompletionWaitSeconds"]
    try:
        go_sram(port)
        audit["launchAcknowledged"] = True
    except Exception as error:
        audit["launchAcknowledged"] = False
        audit["launchError"] = str(error)
    # Release BOOT0 even when GO's reply was lost. Let the verified bounded
    # code finish and restore its route before attempting retained readback.
    port.dtr = True
    audit["launchAttempted"] = True
    try:
        audit["readyAcknowledgement"] = read_ready(port, manifest)
    except Exception as error:
        audit["readyError"] = str(error)
    print("Early-RX stock reset/HELLO launch attempted; waiting for bounded completion and retained proof.", flush=True)
    while time.monotonic() < deadline:
        try:
            time.sleep(min(1, max(0, deadline - time.monotonic())))
        except KeyboardInterrupt:
            audit["interruptionDeferredUntilCleanup"] = True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    inspect = commands.add_parser("inspect-build", help="verify compiled provenance without opening USB")
    inspect.add_argument("--build", type=Path, required=True)
    decode = commands.add_parser("decode-capture", help="analyze an existing raw UART capture offline")
    decode.add_argument("capture", type=Path)
    probe = commands.add_parser("probe", help="emit stock PB9 reset train, then fixed HELLO; no firmware write")
    probe.add_argument("--device", required=True)
    probe.add_argument("--case-serial", required=True)
    probe.add_argument("--build", type=Path, required=True)
    probe.add_argument("--case-reference", type=Path, required=True)
    probe.add_argument("--confirm-bridge-sha256", required=True)
    probe.add_argument("--output", type=Path, required=True)
    probe.add_argument("--execute-stock-reset-early-hello", action="store_true", required=True)
    probe.add_argument("--empty-case-check", action="store_true", help="both temples must be outside; qualify case execution only")
    args = parser.parse_args()
    if args.command == "decode-capture":
        print(json.dumps(classify_capture(args.capture.read_bytes()), indent=2)); return 0
    manifest, payload = inspect_build(args.build)
    if args.command == "inspect-build":
        print(json.dumps(manifest, indent=2)); return 0
    if args.confirm_bridge_sha256 != digest(payload):
        parser.error("exact compiled bridge SHA-256 confirmation required")
    if args.output.suffix != ".json":
        parser.error("output must be a .json audit path; retained bytes use a separate .bin path")
    if args.output.exists() or args.output.with_suffix(".bin").exists():
        parser.error("output audit/result paths must be fresh")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    audit = {
        "schemaVersion": 1, "capturedAt": datetime.now(timezone.utc).isoformat(),
        "operation": "stock-pb9-reset-then-early-hello", "device": args.device,
        "caseSerial": args.case_serial.upper(), "build": manifest,
        "firmwareBytesSent": 0, "caseFlashWrites": 0, "apolloResetVerified": False,
        "firmwareWriteImplemented": False, "outcome": "not-started",
        "emptyCaseCheck": args.empty_case_check, "resetEvidence": "case-waveform-only-not-measured-apollo-reset",
    }
    touched = False
    try:
        reference = args.case_reference.read_bytes()[32:]
        if digest(reference) != CASE_CODE_SHA256:
            raise ValueError("case reference does not match the immutable reviewed stock code")
        if manifest["resetTrace"] != json.loads(json.dumps(extract(args.case_reference.read_bytes()))):
            raise ValueError("manifest reset trace differs from reviewed native case trace")
        audit["preflight"] = preflight(args.device, args.case_serial, manifest["route"], args.empty_case_check)
        if args.empty_case_check and (audit["preflight"]["left_present"] or audit["preflight"]["right_present"]):
            raise ValueError("empty-case qualification requires both temples outside the contacts")
        touched = True
        with open_rom_loader(args.device) as port:
            require_expected_identity(port)
            verify_case_code(port, reference, audit, args.output)
            padded = payload + bytes((-len(payload)) % 4)
            for offset in range(0, len(padded), 256):
                write_verified_sram(port, BASE + offset, padded[offset:offset + 256])
            write_verified_sram(port, RESULT, bytes(RESULT_BYTES))
            launch_and_wait(port, manifest, audit)
        with open_rom_loader(args.device) as port:
            require_expected_identity(port)
            data = read_range(port, RESULT, RESULT_BYTES)
            args.output.with_suffix(".bin").write_bytes(data)
            audit["result"] = decode_result(data, manifest)
            audit["volatileExecutionProvenByRetainedResult"] = True
            # Clear only the exact retained result region and verify readback.
            write_verified_sram(port, RESULT, bytes(RESULT_BYTES))
            audit["retainedResultCleared"] = True
        result = audit["result"]
        if result["status"] or not result["exactRestorationVerified"] or result["uartErrorMask"] or "readyAcknowledgement" not in audit:
            raise ValueError("discovery stopped or transport/restoration is not fully proven")
        audit["outcome"] = result["discovery"]["state"]
    except (Exception, KeyboardInterrupt) as error:
        audit["error"] = str(error) or type(error).__name__
        audit["outcome"] = "failed-closed"
    finally:
        if touched:
            try:
                audit["restoredCaseVersion"] = restore_application(args.device, expected_version="1.2.57")
            except Exception as error:
                audit["restoreError"] = str(error); audit["outcome"] = "restore-not-verified"
        args.output.write_text(json.dumps(audit, indent=2) + "\n")
    print(json.dumps(audit, indent=2))
    return 0 if audit["outcome"] == "sbl-status-verified" else 2


if __name__ == "__main__":
    sys.exit(main())
