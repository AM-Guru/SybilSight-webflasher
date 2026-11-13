#!/usr/bin/env python3
"""Derive exact schema-14 patch and restore pages from the qualified baseline."""

import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from case_even_bootlog_capture.artifacts import inspect
from case_native_task_flash.build import CASE_SERIAL
from case_native_task_hello_flash.build import load_pages as load_baseline, sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("build", "base-plan", "base-hello-build", "case-reference", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("output must be fresh")
    manifest, artifacts = inspect(args.build, args.case_reference)
    baseline = load_baseline(args.base_plan, args.base_hello_build, args.case_reference)
    stock = args.case_reference.read_bytes()[32:]
    args.output.mkdir(parents=True)
    rows = []
    for page, address in enumerate((0x08009800, 0x0800D800)):
        offset = address - 0x08000000
        original = stock[offset:offset + 2048].ljust(2048, b"\xff")
        if baseline[page][0] != original:
            raise ValueError("qualified baseline original page differs")
        patched = artifacts["patched-case"][offset:offset + 2048].ljust(2048, b"\xff")
        row = {
            "address": hex(address), "bytes": 2048, "bankLocalPage": offset // 2048,
            "physicalBankSelectedByStock": 2,
        }
        for kind, data in (("original", original), ("patched", patched)):
            filename = f"{kind}-{address:08x}.bin"
            (args.output / filename).write_bytes(data)
            row[kind + "File"] = filename
            row[kind + "Sha256"] = sha(data)
        rows.append(row)
    report = {
        "operation": "offline-two-page-passive-even-bootlog-plan",
        "schemaVersion": 14,
        "executionReady": False,
        "caseSerial": CASE_SERIAL,
        "probeBuildSha256": manifest["payloadSha256"],
        "basePlanSha256": sha((args.base_plan / "plan.json").read_bytes()),
        "pages": rows,
        "effectiveFlashOptr": "0xdeefe1aa",
        "patchOrder": ["0x0800d800", "0x08009800"],
        "restoreOrder": ["0x08009800", "0x0800d800"],
        "hardwareFlashWrites": 0,
        "insertionWaitTicks": 12000,
        "passiveCaptureTicks": 15000,
        "postPulseCaptureTicks": 3000,
        "captureClock": "systick-wrap-counter",
        "captureStartsBeforeInsertion": True,
        "retentionPolicy": "first-bytes-saturating",
        "templeCommandAllowlist": [],
        "maxTempleBytesSent": 0,
        "templeFirmwareImageBytes": 0,
        "boundary": (
            "Offline exact-page derivation from the qualified schema-11 baseline. No Case "
            "mutation, physical insertion/reset, temple command, or firmware transfer."
        ),
    }
    (args.output / "plan.json").write_text(json.dumps(report, indent=2) + "\n")
    print("Prepared exact schema-14 passive patch/restore pages; no hardware access.")


if __name__ == "__main__":
    main()
