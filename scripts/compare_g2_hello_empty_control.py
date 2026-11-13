#!/usr/bin/env python3
"""Compare a qualified empty-Case HELLO baseline with seated 115200 captures."""

import argparse
import hashlib
import json
from pathlib import Path


HELLO = bytes.fromhex("14559de900000800")
CASE_SERIAL = "002300405845501620373941"


def read(path):
    raw = path.read_bytes()
    return json.loads(raw), hashlib.sha256(raw).hexdigest()


def compare(goal):
    empty_path = goal / "reset-early-empty-right-115200-control-20261111-v1.json"
    empty, empty_sha = read(empty_path)
    baseline = empty["result"]
    if (
        empty.get("caseSerial") != CASE_SERIAL
        or empty.get("emptyCaseCheck") is not True
        or empty["preflight"].get("left_present") is not False
        or empty["preflight"].get("right_present") is not False
        or baseline.get("templeBytesSent") != 160
        or baseline.get("totalReceiveBytes") != 160
        or bytes.fromhex(baseline["rawCaptureHex"]) != HELLO * 16
        or baseline.get("uartErrorMask") != 0
    ):
        raise ValueError("empty Case baseline is not the qualified HELLO control")

    seated = {}
    for route in ("left", "right"):
        path = goal / f"case-output-off-reset-sbl-hello-115200-original-{route}-v1/audit.json"
        audit, audit_sha = read(path)
        result = audit["nativeHello"][route]
        raw = bytes.fromhex(result["rawCaptureHex"])
        if (
            audit.get("caseSerial") != CASE_SERIAL
            or audit["preflight"].get("left_present") is not True
            or audit["preflight"].get("right_present") is not True
            or result.get("probeQualified") is not True
            or result.get("brr") != 556
            or result.get("templeBytesSent") != 160
            or result.get("totalReceiveBytes") != 161
            or raw != b"\0" + HELLO * 20
            or result.get("sblStatusFrames") != []
            or audit.get("fullOriginalCodeAndMirrorsVerified") is not True
            or audit.get("originalSramRestoredAndVerified") is not True
            or audit.get("stockVersionRestored") != "1.2.57"
            or audit.get("stockOutputAfterRestoreVerified") is not True
        ):
            raise ValueError(f"{route} seated capture does not match qualified W22 evidence")
        seated[route] = {
            "audit": str(path), "auditSha256": audit_sha,
            "caseTransmittedBytes": 160, "receivedBytes": len(raw),
            "leadingByteHex": raw[:1].hex(),
            "remainingBytesAreTwentyExactHelloCopies": raw[1:] == HELLO * 20,
            "last128BytesEqualEmptyCaseControl": raw[-128:] == bytes.fromhex(baseline["rawCaptureHex"]),
            "uartErrorMask": result["uartErrorMask"],
            "crcValidSblStatusFrames": 0,
        }

    return {
        "operation": "empty-case-vs-seated-115200-hello-control-comparison",
        "caseSerial": CASE_SERIAL,
        "emptyCaseControl": {
            "audit": str(empty_path), "auditSha256": empty_sha,
            "bothContactsAbsent": True, "caseTransmittedBytes": 160,
            "caseReceivedBytes": 160, "retainedBytes": 128,
            "retainedBytesAreSixteenExactHelloCopies": True,
        },
        "seatedOriginal": seated,
        "inference": (
            "The empty Case itself records HELLO copies. The seated W22 copies have "
            "the same trailing 128 bytes and do not identify a temple transmitter. "
            "The additional leading error-marked 00 in each seated capture is not "
            "an authenticated response. The three captures use different Case "
            "programs/timing, so this comparison cannot locate the electrical "
            "echo source or prove temple delivery or Apollo reset."
        ),
        "authenticatedTempleResponseObserved": False,
        "physicalApolloResetVerified": False,
        "glassesRecovered": False,
        "additionalHardwareCommandsSent": 0,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--goal", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("output must be fresh")
    report = compare(args.goal.resolve())
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"output": str(args.output), "comparisonQualified": True,
                      "authenticatedTempleResponseObserved": False}))


if __name__ == "__main__":
    main()
