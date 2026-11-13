#!/usr/bin/env python3
"""Run a model-validated, fixed HELLO-only SRAM probe on one exact G2 case.

This is application-independent discovery, not an Apollo firmware uploader.
No erase, image, descriptor, abort, recovery or SBL reset command is exposed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import sys
import time
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from g2_case_pogo_flasher import _open_case_console, _drain_case_console, parse_case_restore_evidence
from g2_case_rom import open_rom_loader, require_expected_identity, read_memory, write_sram, go_sram, restore_application
from g2_sbl_protocol import HELLO, classify_capture, parse_ready_frame, ENTRY_BIASES, bias_configuration, ready_frame_bytes
from case_sbl_discovery.artifacts import inspect_build, decode_result

BASE, RESULT, RESULT_BYTES = 0x20010000, 0x20011a00, 256
CASE_CODE_SHA256 = "773b6d4cfdaf0a5a74a557e3babe8222a0ae813436b76a7437c1096d2c60d677"


def digest(data):
    return hashlib.sha256(data).hexdigest()



def preflight(device, case_serial, route, await_insertion=False):
    port = _open_case_console(device)
    try:
        captured = bytearray(_drain_case_console(port, 3.0))
        for command in (b"DEA0\n", b"DEA3\n", b"DED3\n"):
            if port.write(command) != len(command):
                raise ValueError("truncated case diagnostic query")
            port.flush()
            captured.extend(_drain_case_console(port, 1.0))
    finally:
        port.close()
    report = parse_case_restore_evidence(bytes(captured), require_reset_confirmation=False)
    identities = re.findall(rb"B200 1\.2\.57 ([0-9A-Fa-f]{24})", captured)
    if not identities or identities[-1].decode().upper() != case_serial.upper():
        raise ValueError("fresh case identity does not match the selected device")
    if report["ota_glasses"] != 0:
        raise ValueError("fresh inactive temple-OTA proof is required")
    if await_insertion:
        if report[f"{route}_present"]:
            raise ValueError("await-insertion requires the selected temple to be outside the contacts at preflight")
    elif not report["left_present"] or not report["right_present"]:
        raise ValueError("both seated contacts are required for this diagnostic")
    report["caseSerial"] = identities[-1].decode().upper()
    report["rawConsole"] = captured.decode("ascii", "replace")
    return report


def read_range(port, address, count, progress=None):
    # Fresh hardware observation: macOS CH340 truncates larger reads.
    output = bytearray()
    milestone = 0
    for offset in range(0, count, 31):
        output.extend(read_memory(port, address + offset, min(31, count - offset), attempts=2))
        if progress and (len(output) // 8192 != milestone or len(output) == count):
            milestone = len(output) // 8192
            progress(len(output), count)
    return bytes(output)


def verify_case_code(port, reference, audit, output_path):
    """Require two consecutive complete exact matches; retry reads only."""
    audit["caseCodeReadbacks"] = []
    consecutive = 0
    for attempt in range(1, 5):
        live = read_range(port, 0x08000000, len(reference), progress=lambda n,total: print(f"Case code readback {attempt}/4: {n}/{total} bytes", flush=True))
        matches = live == reference
        audit["caseCodeReadbacks"].append({"attempt":attempt, "sha256":digest(live), "matchesPinnedReference":matches})
        if not matches:
            mismatch_path = output_path.with_name(output_path.stem + f"-case-mismatch-{attempt}.bin")
            mismatch_path.write_bytes(live)
            audit["caseCodeReadbacks"][-1]["mismatchCapture"] = str(mismatch_path)
        consecutive = consecutive + 1 if matches else 0
        if consecutive == 2:
            audit["liveCaseCodeSha256"] = digest(live)
            return
    raise ValueError("two consecutive complete pinned case-code matches were not obtained; no SRAM payload uploaded")


def write_verified_sram(port, address, data):
    code_range = BASE <= address and address + len(data) <= BASE + 0x1800
    result_range = RESULT <= address and address + len(data) <= RESULT + RESULT_BYTES
    if not data or len(data) > 256 or not (code_range or result_range):
        raise ValueError("write outside reserved SRAM code/result region")
    write_sram(port, address, data)
    if read_range(port, address, len(data)) != data:
        raise ValueError(f"SRAM readback mismatch at 0x{address:08x}")



def capture_wait_seconds(manifest):
    # RX budget excludes HELLO wire time and native direction changes.
    # Reserve 10 ms/transaction plus five seconds for setup/restoration.
    # This is a conservative host wait, not a physical timing calibration.
    return math.ceil(manifest["nominalReceiveWindowMs"] / 1000 + manifest["attempts"] * (80 / manifest["nominalBaud"] + 0.01) + 5 + (manifest.get("entryBias") or {}).get("holdMs",0) / 1000)


def read_ready(port, manifest):
    deadline = time.monotonic() + 3
    port.timeout = 0.1
    capture = bytearray()
    length = ready_frame_bytes(manifest)
    while time.monotonic() < deadline and len(capture) < 256:
        capture.extend(port.read(1))
        if len(capture) >= length and capture[-length:4-length] == b"G2SB":
            try:
                return parse_ready_frame(bytes(capture[-length:]), manifest)
            except ValueError:
                pass
    raise ValueError("no CRC-valid post-routing Case readiness acknowledgement")


def launch_and_wait(port, manifest, audit, await_insertion):
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
    print("Fixed HELLO launch attempted; waiting for bounded completion and retained proof.", flush=True)
    if await_insertion and "readyAcknowledgement" in audit:
        if manifest.get("entryBias"):
            elapsed = time.monotonic() - launched_at
            audit["readyReceivedWithinLaunchSeconds"] = elapsed
            if elapsed < 2:
                audit["insertionCueIssued"] = True
                print("ARMED: insert the depleted glasses NOW. The weak GPIO bias releases within five seconds, then HELLO capture starts.", flush=True)
            else:
                audit["insertionCueIssued"] = False
                print("Readiness arrived too late for a timed insertion cue; keep glasses outside while cleanup finishes.", flush=True)
        else:
            audit["insertionCueIssued"] = True
            print("ARMED: insert the depleted glasses now. VBUS selection alone does not prove Apollo reset.", flush=True)
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
    probe = commands.add_parser("probe", help="run fixed read-only HELLO discovery through case USB")
    probe.add_argument("--device", required=True)
    probe.add_argument("--case-serial", required=True)
    probe.add_argument("--build", type=Path, required=True)
    probe.add_argument("--case-reference", type=Path, required=True)
    probe.add_argument("--confirm-bridge-sha256", required=True)
    probe.add_argument("--output", type=Path, required=True)
    probe.add_argument("--execute-fixed-hello", action="store_true", required=True)
    mode = probe.add_mutually_exclusive_group()
    mode.add_argument("--await-insertion", action="store_true", help="80-second armed capture; selected temple must initially be outside contacts")
    mode.add_argument("--empty-case-check", action="store_true", help="qualify Case execution/readiness/restoration with both temples outside; never prints an insertion cue")
    probe.add_argument("--reset-evidence", choices=("unknown","operator-reported-depleted-insertion"), default="unknown", help="operator report only; never marks a measured Apollo reset")
    args = parser.parse_args()
    if args.command == "decode-capture":
        print(json.dumps(classify_capture(args.capture.read_bytes()), indent=2)); return 0
    manifest, payload = inspect_build(args.build)
    if args.command == "inspect-build":
        print(json.dumps(manifest, indent=2)); return 0
    if args.confirm_bridge_sha256 != digest(payload):
        parser.error("exact compiled bridge SHA-256 confirmation required")
    if args.await_insertion and manifest["attempts"] != 4000:
        parser.error("await-insertion requires the model-validated 4000-attempt build")
    if not args.await_insertion and not args.empty_case_check and manifest["attempts"] != 20:
        parser.error("seated diagnostics require the bounded 20-attempt build")
    if manifest.get("entryBias") and not (args.await_insertion or args.empty_case_check):
        parser.error("GPIO bias requires absent-temple insertion or an empty-case check")
    if manifest.get("entryBias") and args.await_insertion and args.reset_evidence != "operator-reported-depleted-insertion":
        parser.error("GPIO insertion needs a current depleted-battery report; case VBUS is not a reset")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    audit = {
        "schemaVersion": 1, "capturedAt": datetime.now(timezone.utc).isoformat(),
        "operation": "application-independent-sbl-discovery", "device": args.device,
        "caseSerial": args.case_serial.upper(), "build": manifest,
        "firmwareBytesSent": 0, "caseFlashWrites": 0, "apolloResetVerified": False,
        "firmwareWriteImplemented": False, "outcome": "not-started",
        "emptyCaseCheck": args.empty_case_check, "awaitInsertion": args.await_insertion,
        "resetEvidence": args.reset_evidence,
    }
    touched = False
    try:
        reference = args.case_reference.read_bytes()[32:]
        if digest(reference) != CASE_CODE_SHA256:
            raise ValueError("case reference does not match the immutable reviewed stock code")
        audit["preflight"] = preflight(args.device, args.case_serial, manifest["route"], args.await_insertion or args.empty_case_check)
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
            launch_and_wait(port, manifest, audit, args.await_insertion)
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
        if args.await_insertion and not audit.get("insertionCueIssued"):
            raise ValueError("no timely verified insertion cue was issued")
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
