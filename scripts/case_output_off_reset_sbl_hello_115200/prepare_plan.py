#!/usr/bin/env python3
"""Derive schema-18 off-reset-sbl-hello-115200 patch and restore pages from stock."""

import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from case_output_off_reset_sbl_hello_115200.artifacts import inspect
from case_native_task_flash.build import CASE_SERIAL
from case_native_task_hello_flash.build import sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("build", "base-plan", "case-reference", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("output must be fresh")
    manifest, artifacts = inspect(args.build, args.case_reference)
    base_report = json.loads((args.base_plan / "plan.json").read_text())
    if (
        base_report.get("operation") != "offline-two-page-passive-even-bootlog-plan"
        or base_report.get("schemaVersion") != 14
        or base_report.get("caseSerial") != CASE_SERIAL
        or len(base_report.get("pages", [])) != 2
    ):
        raise ValueError("qualified schema-14 baseline plan differs")
    stock = args.case_reference.read_bytes()[32:]
    args.output.mkdir(parents=True)
    rows = []
    for page, address in enumerate((0x08009800, 0x0800D800)):
        offset = address - 0x08000000
        original = stock[offset:offset + 2048].ljust(2048, b"\xff")
        base_row = base_report["pages"][page]
        baseline = (args.base_plan / base_row["originalFile"]).read_bytes()
        if (
            int(base_row["address"], 16) != address
            or baseline != original
            or sha(baseline) != base_row["originalSha256"]
        ):
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
        "operation": "offline-two-page-seated-yhm-off-reset-sbl-hello-115200-plan",
        "schemaVersion": 18,
        "executionReady": False,
        "caseSerial": CASE_SERIAL,
        "probeBuildSha256": manifest["hookSha256"],
        "basePlanSha256": sha((args.base_plan / "plan.json").read_bytes()),
        "pages": rows,
        "effectiveFlashOptr": "0xdeefe1aa",
        "patchOrder": ["0x0800d800", "0x08009800"],
        "restoreOrder": ["0x08009800", "0x0800d800"],
        "hardwareFlashWrites": 0,
        "outputOffCaptureTicks": 3000,
        "outputOnCaptureTicks": 12000,
        "postPulseCaptureTicks": 12000,
        "captureClock": "systick-wrap-counter",
        "captureStartsBeforeYhmOnEdge": True,
        "retentionPolicy": "first-bytes-saturating",
        "rawInputPin": "STM32-PB9",
        "rawInputTransitionCounters": True,
        "templeCommandAllowlist": ["14559de900000800"],
        "maxTempleBytesSent": 160,
        "templeFirmwareImageBytes": 0,
        "boundary": (
            "Offline exact-page derivation from the qualified schema-11 baseline. No Case "
            "mutation, physical insertion/reset, temple command, or firmware transfer."
        ),
    }
    (args.output / "plan.json").write_text(json.dumps(report, indent=2) + "\n")
    print("Prepared exact schema-18 off-reset-sbl-hello-115200 patch/restore pages; no hardware access.")


if __name__ == "__main__":
    main()
