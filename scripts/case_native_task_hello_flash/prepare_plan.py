#!/usr/bin/env python3
"""Prepare exact schema-11 HELLO patch/restore pages; never opens hardware."""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from case_native_task_hello.artifacts import inspect_build
from case_native_task_flash.build import CASE_SERIAL, sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in (
        "build",
        "case-reference",
        "storage-qualification",
        "mapping-audit",
        "bank-audit",
        "output",
    ):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("output must be fresh")

    manifest, artifacts = inspect_build(args.build, args.case_reference)
    storage = json.loads(args.storage_qualification.read_text())
    mapping = json.loads(args.mapping_audit.read_text())
    bank = json.loads(args.bank_audit.read_text())
    if (
        storage.get("outcome") != "retention-and-erased-tail-qualified"
        or storage.get("flashWrites") != 0
        or storage.get("stockRestored") is not True
        or storage.get("originalSramRestoredAndVerified") is not True
        or storage.get("retainedAllBytes") is not True
        or storage.get("flashSizeKiB") != 512
    ):
        raise ValueError("storage not qualified")
    reads = storage.get("caseCodeReadbacks", [])
    if len(reads) != 2 or not all(
        row["matchesPinnedReference"]
        and row["sha256"] == manifest["stockCodeSha256"]
        for row in reads
    ):
        raise ValueError("two matching full code reads required")
    if (
        mapping.get("outcome") != "effective-registers-read"
        or mapping.get("caseSerial") != CASE_SERIAL
        or mapping.get("caseSerial") != storage.get("caseSerial")
        or mapping.get("originalSramRestored") is not True
        or mapping.get("stockVersionRestored") != "1.2.57"
        or mapping.get("flashWrites") != 0
    ):
        raise ValueError("mapping audit not qualified")
    expected_mapping = {
        "optr": "0xdeefe1aa",
        "acr": "0x600",
        "cr": "0xc0000000",
        "sr": "0x0",
        "nSwapBankBit": 0,
        "dualBankBit": 1,
        "rdpByte": "0xaa",
    }
    if mapping.get("result") != expected_mapping:
        raise ValueError("effective register fixture differs")
    if (
        bank.get("passed") is not True
        or bank.get("currentReadOnlyOptr") != expected_mapping["optr"]
        or bank.get("currentStockBankSelection") != 2
        or len(bank.get("cases", [])) != 18
        or not all(row["passed"] for row in bank["cases"])
    ):
        raise ValueError("native stock bank audit incomplete")
    if len(storage.get("pages", [])) != 2:
        raise ValueError("both complete saved pages required")

    stock = args.case_reference.read_bytes()[32:]
    rows = []
    for saved, address in zip(storage["pages"], (0x08009800, 0x0800D800)):
        if int(saved["address"], 16) != address or saved["bytes"] != 2048:
            raise ValueError("wrong saved page bounds/order")
        original = (args.storage_qualification.parent / saved["saved"]).read_bytes()
        offset = address - 0x08000000
        if len(original) != 2048 or sha(original) != saved["sha256"]:
            raise ValueError("saved page identity mismatch")
        prefix = stock[offset : offset + 2048]
        if original[: len(prefix)] != prefix or original[len(prefix) :] != b"\xff" * (
            2048 - len(prefix)
        ):
            raise ValueError("saved page differs from stock plus erased tail")
        patched = bytearray(original)
        replacement = artifacts["patched-case"][offset : offset + 2048]
        patched[: len(replacement)] = replacement
        rows.append(
            {
                "address": hex(address),
                "bytes": 2048,
                "bankLocalPage": offset // 2048,
                "physicalBankSelectedByStock": 2,
                "originalSha256": sha(original),
                "patchedSha256": sha(patched),
                "original": original,
                "patched": bytes(patched),
            }
        )

    args.output.mkdir(parents=True)
    for row in rows:
        address = int(row["address"], 16)
        for kind in ("original", "patched"):
            filename = f"{kind}-{address:08x}.bin"
            (args.output / filename).write_bytes(row.pop(kind))
            row[kind + "File"] = filename
    report = {
        "operation": "offline-two-page-native-task-hello-plan",
        "schemaVersion": 11,
        "executionReady": False,
        "caseSerial": CASE_SERIAL,
        "helloBuildSha256": manifest["payloadSha256"],
        "pages": rows,
        "effectiveFlashOptr": expected_mapping["optr"],
        "physicalBankSelectionBasis": (
            "actual stock code plus read-only effective OPTR; no ROM erase-command "
            "index mapping asserted"
        ),
        "patchOrder": ["0x0800d800", "0x08009800"],
        "restoreOrder": ["0x08009800", "0x0800d800"],
        "hardwareFlashWrites": 0,
        "templeCommandAllowlist": ["14559de900000800"],
        "maxTempleBytes": 160,
        "templeFirmwareImageBytes": 0,
        "boundary": (
            "Plan files only. No hardware access, case-hook installation, temple "
            "firmware upload, or physical reset/SBL communication is proved."
        ),
    }
    (args.output / "plan.json").write_text(json.dumps(report, indent=2) + "\n")
    print("Prepared exact schema-11 HELLO patch and restore pages; no hardware access.")


if __name__ == "__main__":
    main()
