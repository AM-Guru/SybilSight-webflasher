#!/usr/bin/env python3
"""Bind the schema-12 hardware revisions without opening the Case USB port."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

from case_armed_sbl_probe.artifacts import inspect_build
from case_armed_sbl_probe_flash.artifacts import inspect as inspect_writer
from case_sbl_reset_prepared.trace import fnv


def sha(data):
    return hashlib.sha256(data).hexdigest()


def restored(audit):
    transaction = audit.get("transaction", {})
    return (
        audit.get("fullOriginalCodeAndMirrorsVerified") is True
        and audit.get("originalSramRestoredAndVerified") is True
        and audit.get("stockVersionRestored") == "1.2.57"
        and transaction.get("pagesRestored") is True
        and transaction.get("fullStockVerified") is True
        and transaction.get("sramRestored") is True
        and transaction.get("stockBooted") is True
        and transaction.get("restoreErrors") == []
    )


def words(path):
    data = path.read_bytes()
    if len(data) != 512:
        raise ValueError("schema-12 retained evidence size differs")
    return data, struct.unpack("<128I", data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--goal", type=Path, required=True)
    parser.add_argument("--sdk-source", type=Path, required=True)
    parser.add_argument("--case-reference", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("output must be fresh")

    first = args.goal / "armed-sbl-positive-control-left-115200-hardware-v1"
    second = args.goal / "armed-sbl-positive-control-left-v2-115200-hardware-v1"
    third = args.goal / "armed-sbl-positive-control-left-v2-115200-hardware-v2"
    audits = [json.loads((path / "audit.json").read_text()) for path in (first, second, third)]
    if not all(restored(audit) for audit in audits):
        raise ValueError("a hardware revision lacks complete stock restoration")
    if any(audit.get("validSblStatusFrames") != 0 for audit in audits):
        raise ValueError("unexpected prior valid STATUS claim")

    first_data, first_words = words(first / "armed-sbl-left-result.bin")
    if (
        first_words[0] != 0x31484E47
        or first_words[1] != 12
        or first_words[2] != 1
        or first_words[18:21] != (0, 0, 0)
        or first_words[37] != 0
        or first_words[127] != fnv(first_data[:508])
    ):
        raise ValueError("first BRR-0 precondition evidence differs")

    torn = []
    for path in (second, third):
        data, row = words(path / "armed-sbl-left-result.bin")
        if (
            row[0] != 0
            or row[1:4] != (12, 0, 4)
            or row[18:24] != (10, 80, 80, 80, 0, 0)
            or row[28] != 9
            or row[127] != 0
            or fnv(data[:508]) == row[127]
            or data[256:336] != bytes.fromhex("14559de900000800") * 10
        ):
            raise ValueError("repeatable attempt-10 torn evidence differs")
        torn.append({
            "audit": str((path / "audit.json").resolve()),
            "evidenceSha256": sha(data),
            "stage": row[3],
            "attempts": row[18],
            "templeBytesSent": row[19],
            "receiveBytes": row[20],
            "uartErrorMask": row[22],
            "finalChecksumWritten": False,
            "stockRestored": True,
        })

    sdk = args.sdk_source.read_text()
    match = re.search(r"#define\s+AM_DEVICES_COOPER_SBL_MAX_COMM_ERR_COUNT\s+0x([0-9A-Fa-f]+)", sdk)
    if not match or int(match.group(1), 16) != 3:
        raise ValueError("vendor communication retry limit differs")

    build = args.goal / "armed-sbl-probe-build-v7-four-attempt"
    plan = args.goal / "armed-sbl-probe-plan-v3-four-attempt"
    writer = args.goal / "armed-sbl-probe-writer-build-v3-four-attempt"
    manifest, _artifacts = inspect_build(build, args.case_reference)
    writer_report, _payload, _pages = inspect_writer(
        writer, plan, build, args.case_reference
    )
    if (
        manifest.get("maxTempleBytes") != 32
        or len(manifest.get("cases", [])) != 41
        or writer_report.get("maxTempleBytes") != 32
        or len(writer_report.get("cases", [])) != 27
    ):
        raise ValueError("current four-attempt artifact bounds differ")

    report = {
        "operation": "schema12-hardware-revision-and-next-artifact-audit",
        "passed": True,
        "physicalDevicesOpened": False,
        "caseFlashWrites": 0,
        "templeFirmwareImageBytesSent": 0,
        "validSblStatusFrames": 0,
        "firstRun": {
            "audit": str((first / "audit.json").resolve()),
            "evidenceSha256": sha(first_data),
            "status": 1,
            "savedDisabledUartBrr": first_words[37],
            "templeBytesSent": first_words[19],
            "stockRestored": True,
        },
        "repeatableTornRuns": torn,
        "vendorCommunicationErrorRetryLimit": 3,
        "vendorMaximumHelloTransmissions": 4,
        "vendorSource": str(args.sdk_source.resolve()),
        "currentProbe": {
            "build": str(build.resolve()),
            "payloadSha256": manifest["payloadSha256"],
            "compiledCases": len(manifest["cases"]),
            "attempts": 4,
            "maxTempleBytes": 32,
        },
        "currentWriter": {
            "build": str(writer.resolve()),
            "payloadSha256": writer_report["payloadSha256"],
            "compiledCases": len(writer_report["cases"]),
            "hardwareStagingQualified": False,
        },
        "nextGate": (
            "Confirm the secondary is outside and the Case is empty; then run the current "
            "writer's live mode-2 zero-flash staging qualification before one 115200 probe."
        ),
        "boundary": (
            "The three prior Case transactions and their retained SRAM evidence are bound. "
            "No prior result is a qualified no-STATUS result, no Apollo reset is proved, and "
            "the four-attempt artifact has not executed on hardware."
        ),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
