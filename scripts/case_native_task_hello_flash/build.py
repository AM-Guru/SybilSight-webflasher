#!/usr/bin/env python3
"""Build an exact-content writer for the schema-11 HELLO case pages."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from case_native_task_hello.artifacts import inspect_build as inspect_hello
from case_native_task_flash.build import CASE_SERIAL
from case_native_task_flash.validate import validate

ROOT = Path(__file__).resolve().parent
WRITER_ROOT = ROOT.parent / "case_native_task_flash"
SOURCES = ("build.py",)
WRITER_SOURCES = ("writer.c", "start.S", "link.ld", "protocol.py", "validate.py")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def source_paths():
    return [ROOT / name for name in SOURCES] + [WRITER_ROOT / name for name in WRITER_SOURCES]


def load_pages(plan, hello_build, reference):
    manifest, artifacts = inspect_hello(hello_build, reference)
    report = json.loads((plan / "plan.json").read_text())
    if (
        report.get("operation") != "offline-two-page-native-task-hello-plan"
        or report.get("schemaVersion") != 11
        or report.get("caseSerial") != CASE_SERIAL
        or report.get("helloBuildSha256") != manifest["payloadSha256"]
        or report.get("effectiveFlashOptr") != "0xdeefe1aa"
        or report.get("templeCommandAllowlist") != ["14559de900000800"]
        or report.get("maxTempleBytes") != 160
        or len(report.get("pages", [])) != 2
    ):
        raise ValueError("unexpected schema-11 HELLO plan")
    stock = reference.read_bytes()[32:]
    pages = []
    for row, address in zip(report["pages"], (0x08009800, 0x0800D800)):
        if (
            int(row["address"], 16) != address
            or row["bankLocalPage"] != (address - 0x08000000) // 2048
            or row["physicalBankSelectedByStock"] != 2
            or row["bytes"] != 2048
        ):
            raise ValueError("wrong exact page layout")
        offset = address - 0x08000000
        expected = stock[offset : offset + 2048].ljust(2048, b"\xff")
        patched = artifacts["patched-case"][offset : offset + 2048].ljust(
            2048, b"\xff"
        )
        pair = []
        for kind, value in (("original", expected), ("patched", patched)):
            data = (plan / row[kind + "File"]).read_bytes()
            if data != value or sha(data) != row[kind + "Sha256"]:
                raise ValueError("plan data differs from exact stock/HELLO patch")
            pair.append(data)
        pages.append(pair)
    return pages


def pages_header(pages):
    rows = [
        f"#define CASE_UID{index} 0x{CASE_SERIAL[8 * index:8 * index + 8]}u"
        for index in range(3)
    ]
    for page, pair in enumerate(pages):
        for kind, data in zip(("original", "patched"), pair):
            words = struct.unpack("<512I", data)
            rows.append(
                f"static const uint32_t {kind}{page}[512]={{"
                + ",".join(f"0x{value:08x}u" for value in words)
                + "};"
            )
    return ("\n".join(rows) + "\n").encode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("plan", "hello-build", "case-reference", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("output must be fresh")
    pages = load_pages(args.plan, args.hello_build, args.case_reference)
    frozen = {os.path.relpath(path, ROOT): sha(path.read_bytes()) for path in source_paths()}
    args.output.mkdir(parents=True)
    (args.output / "pages.h").write_bytes(pages_header(pages))
    for stem, suffix in (("writer", "c"), ("start", "S")):
        subprocess.run(
            [
                "/usr/bin/clang",
                "--target=arm-none-eabi",
                "-mcpu=cortex-m0plus",
                "-mthumb",
                "-Os",
                "-ffreestanding",
                "-fno-builtin",
                "-Wall",
                "-Wextra",
                "-Werror",
                "-I",
                str(args.output),
                "-c",
                str(WRITER_ROOT / f"{stem}.{suffix}"),
                "-o",
                str(args.output / f"{stem}.o"),
            ],
            check=True,
        )
    subprocess.run(
        [
            "arm-none-eabi-ld",
            "-T",
            str(WRITER_ROOT / "link.ld"),
            str(args.output / "start.o"),
            str(args.output / "writer.o"),
            "-o",
            str(args.output / "writer.elf"),
        ],
        check=True,
    )
    subprocess.run(
        [
            "arm-none-eabi-objcopy",
            "-O",
            "binary",
            str(args.output / "writer.elf"),
            str(args.output / "writer.bin"),
        ],
        check=True,
    )
    payload = (args.output / "writer.bin").read_bytes()
    report = {
        "operation": "compiled-exact-case-page-writer-schema11-hello",
        "schemaVersion": 11,
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
        "templeCommandAllowlist": ["14559de900000800"],
        "maxTempleBytes": 160,
        "boundary": (
            "Actual writer instructions run against controller fixtures. No physical "
            "erase/program/restore, Apollo reset, or temple SBL execution is proved."
        ),
    }
    try:
        for row in validate(payload, pages):
            report["cases"].append(row)
            print(f"PASS {row['case']}", flush=True)
        if frozen != {
            os.path.relpath(path, ROOT): sha(path.read_bytes()) for path in source_paths()
        }:
            raise ValueError("writer/validator source changed")
        report["passed"] = True
    finally:
        (args.output / "validated-writer.json").write_text(
            json.dumps(report, indent=2) + "\n"
        )
    print(
        f"Completed {len(report['cases'])} schema-11 writer cases; hardware writes:0.",
        flush=True,
    )


if __name__ == "__main__":
    main()
