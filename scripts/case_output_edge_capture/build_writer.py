#!/usr/bin/env python3
"""Build exact Case page writer for schema-16 output-edge capture."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from case_output_edge_capture.artifacts import inspect
from case_native_task_flash.build import CASE_SERIAL
from case_native_task_flash.validate import CASES, validate


ROOT = Path(__file__).resolve().parent
WRITER_ROOT = ROOT.parent / "case_native_task_flash"
WRITER_SOURCES = ("writer.c", "start.S", "link.ld", "protocol.py", "validate.py")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def source_paths():
    return [Path(__file__)] + [WRITER_ROOT / name for name in WRITER_SOURCES]


def load_pages(plan, probe_build, reference):
    manifest, artifacts = inspect(probe_build, reference)
    report = json.loads((plan / "plan.json").read_text())
    if (
        report.get("operation") != "offline-two-page-seated-yhm-output-edge-plan"
        or report.get("schemaVersion") != 16
        or report.get("caseSerial") != CASE_SERIAL
        or report.get("probeBuildSha256") != manifest["hookSha256"]
        or report.get("effectiveFlashOptr") != "0xdeefe1aa"
        or report.get("templeCommandAllowlist") != []
        or report.get("maxTempleBytesSent") != 0
        or len(report.get("pages", [])) != 2
    ):
        raise ValueError("unexpected schema-16 output-edge plan")
    stock = reference.read_bytes()[32:]
    pages = []
    for row, address in zip(report["pages"], (0x08009800, 0x0800D800)):
        offset = address - 0x08000000
        if (
            int(row["address"], 16) != address
            or row["bankLocalPage"] != offset // 2048
            or row["physicalBankSelectedByStock"] != 2
            or row["bytes"] != 2048
        ):
            raise ValueError("wrong passive exact page layout")
        expected = stock[offset:offset + 2048].ljust(2048, b"\xff")
        patched = artifacts["patched-case"][offset:offset + 2048].ljust(2048, b"\xff")
        pair = []
        for kind, value in (("original", expected), ("patched", patched)):
            data = (plan / row[kind + "File"]).read_bytes()
            if data != value or sha(data) != row[kind + "Sha256"]:
                raise ValueError("passive plan data differs from exact artifact")
            pair.append(data)
        pages.append(pair)
    return pages


def pages_header(pages):
    rows = [f"#define CASE_UID{i} 0x{CASE_SERIAL[8*i:8*i+8]}u" for i in range(3)]
    for page, pair in enumerate(pages):
        for kind, data in zip(("original", "patched"), pair):
            words = struct.unpack("<512I", data)
            rows.append(
                f"static const uint32_t {kind}{page}[512]={{"
                + ",".join(f"0x{value:08x}u" for value in words) + "};"
            )
    return ("\n".join(rows) + "\n").encode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("plan", "probe-build", "case-reference", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("output must be fresh")
    pages = load_pages(args.plan, args.probe_build, args.case_reference)
    frozen = {os.path.relpath(path, ROOT): sha(path.read_bytes()) for path in source_paths()}
    args.output.mkdir(parents=True)
    (args.output / "pages.h").write_bytes(pages_header(pages))
    for stem, suffix in (("writer", "c"), ("start", "S")):
        subprocess.run([
            "/usr/bin/clang", "--target=arm-none-eabi", "-mcpu=cortex-m0plus", "-mthumb",
            "-Os", "-ffreestanding", "-fno-builtin", "-Wall", "-Wextra", "-Werror",
            "-I", str(args.output), "-c", str(WRITER_ROOT / f"{stem}.{suffix}"),
            "-o", str(args.output / f"{stem}.o"),
        ], check=True)
    subprocess.run([
        "arm-none-eabi-ld", "-T", str(WRITER_ROOT / "link.ld"),
        str(args.output / "start.o"), str(args.output / "writer.o"),
        "-o", str(args.output / "writer.elf"),
    ], check=True)
    subprocess.run([
        "arm-none-eabi-objcopy", "-O", "binary", str(args.output / "writer.elf"),
        str(args.output / "writer.bin"),
    ], check=True)
    payload = (args.output / "writer.bin").read_bytes()
    report = {
        "operation": "compiled-exact-case-page-writer-schema16-output-edge",
        "schemaVersion": 16,
        "caseSerial": CASE_SERIAL,
        "payloadBytes": len(payload),
        "payloadSha256": sha(payload),
        "sourceHashes": frozen,
        "pagesHeaderSha256": sha((args.output / "pages.h").read_bytes()),
        "passed": False,
        "cases": [],
        "hardwareFlashWrites": 0,
        "hardwareQualified": False,
        "hostMutationRunnerImplemented": False,
        "templeCommandAllowlist": [],
        "maxTempleBytesSent": 0,
        "boundary": "Controller fixtures only; no physical erase/program/restore or temple execution.",
    }
    try:
        report["cases"] = list(validate(payload, pages))
        if frozen != {os.path.relpath(path, ROOT): sha(path.read_bytes()) for path in source_paths()}:
            raise ValueError("passive writer source changed")
        report["passed"] = True
    finally:
        (args.output / "validated-writer.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"Completed {len(report['cases'])} schema-16 writer cases; hardware writes:0.")


if __name__ == "__main__":
    main()
