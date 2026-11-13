#!/usr/bin/env python3
"""Build the offline-only schema-13 stock SBL Case bridge."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import zlib

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from case_native_task_recovery.build import encode_bl
from case_sbl_stock_writer.validate import validate, validate_baud_patch
from g2_case_pogo_flasher import BRIDGE_BYTES, build_sbl_hello_probe_bridge
from g2_case_rom import SRAM_ADDRESS
from g2_sbl_image import parse_apollo_standard_image
from g2_sbl_wire import image_segments
from case_sbl_stock_writer.stock_release import expected_stock_version

ROOT = Path(__file__).resolve().parent
SOURCES = (
    "validator.c", "link.ld", "baud_patch.S", "baud_link.ld",
    "validate.py", "build.py", "stock_release.py",
)
PATCH_START = 0x380
PATCH_END = 0x48A
BAUD_PATCH_START = 0x67C
BAUD_PATCH_END = 0x6C0
BAUD_CALL_SITES = (0x288, 0x2B2)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stock-image", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--baud", type=int, choices=(115_200, 1_000_000), required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("output must be fresh")
    stock = args.stock_image.read_bytes()
    stock_version = expected_stock_version(sha(stock))
    parsed = parse_apollo_standard_image(stock)
    if not parsed["g2StockMainEnvelopeCandidate"] or len(image_segments(stock)) != 1:
        parser.error("pinned stock image is not one G2 Apollo main segment")
    stock_crc32 = zlib.crc32(stock) & 0xffffffff
    args.output.mkdir(parents=True)

    subprocess.run([
        "/usr/bin/clang", "--target=arm-none-eabi", "-mcpu=cortex-m0plus", "-mthumb",
        "-Oz", "-ffreestanding", "-fno-builtin",
        f"-DSTOCK_BYTES={len(stock)}u", f"-DSTOCK_CRC32=0x{stock_crc32:08x}u",
        "-ffunction-sections",
        "-fdata-sections", "-Wall", "-Wextra", "-Werror", "-c",
        str(ROOT / "validator.c"), "-o", str(args.output / "validator.o"),
    ], check=True)
    subprocess.run([
        "arm-none-eabi-ld", "-T", str(ROOT / "link.ld"),
        str(args.output / "validator.o"), "-o", str(args.output / "validator.elf"),
    ], check=True)
    subprocess.run([
        "arm-none-eabi-objcopy", "-O", "binary", str(args.output / "validator.elf"),
        str(args.output / "validator.bin"),
    ], check=True)
    validator = (args.output / "validator.bin").read_bytes()
    if not validator or len(validator) > PATCH_END - PATCH_START or len(validator) % 2:
        raise ValueError("schema-13 validator does not fit its original bridge slot")

    brr = 556 if args.baud == 115_200 else 64
    subprocess.run([
        "/usr/bin/clang", "--target=arm-none-eabi", "-mcpu=cortex-m0plus", "-mthumb",
        "-x", "assembler-with-cpp", f"-DUART_BRR={brr}", "-c",
        str(ROOT / "baud_patch.S"), "-o", str(args.output / "baud_patch.o"),
    ], check=True)
    subprocess.run([
        "arm-none-eabi-ld", "-T", str(ROOT / "baud_link.ld"),
        str(args.output / "baud_patch.o"), "-o", str(args.output / "baud_patch.elf"),
    ], check=True)
    subprocess.run([
        "arm-none-eabi-objcopy", "-O", "binary", str(args.output / "baud_patch.elf"),
        str(args.output / "baud_patch.bin"),
    ], check=True)
    baud_patch = (args.output / "baud_patch.bin").read_bytes()
    if not baud_patch or len(baud_patch) > BAUD_PATCH_END - BAUD_PATCH_START or len(baud_patch) % 2:
        raise ValueError("schema-13 baud patch does not fit its reviewed NOP cave")

    base = bytearray(build_sbl_hello_probe_bridge())
    if base[BAUD_PATCH_START:BAUD_PATCH_END] != bytes.fromhex("00bf") * (
        (BAUD_PATCH_END - BAUD_PATCH_START) // 2
    ):
        raise ValueError("schema-13 source NOP cave differs")
    for site in BAUD_CALL_SITES:
        if base[site:site + 4] != bytes.fromhex("984772b6"):
            raise ValueError(f"schema-13 source UART-init call differs at 0x{site:x}")
        base[site:site + 4] = encode_bl(
            SRAM_ADDRESS + site, SRAM_ADDRESS + BAUD_PATCH_START
        )
    base[BAUD_PATCH_START:BAUD_PATCH_END] = baud_patch + bytes.fromhex("00bf") * (
        (BAUD_PATCH_END - BAUD_PATCH_START - len(baud_patch)) // 2
    )
    original_region = bytes(base[PATCH_START:PATCH_END])
    padded = validator + bytes.fromhex("00bf") * ((PATCH_END - PATCH_START - len(validator)) // 2)
    if len(padded) != PATCH_END - PATCH_START:
        raise ValueError("schema-13 validator padding differs")
    base[PATCH_START:PATCH_END] = padded
    bridge = bytes(base)
    if len(bridge) != BRIDGE_BYTES:
        raise ValueError("schema-13 bridge size differs")
    (args.output / "bridge.bin").write_bytes(bridge)

    sources = [ROOT / name for name in SOURCES] + [
        ROOT.parent / "case_native_task_recovery/build.py",
        ROOT.parent / "g2_sbl_wire.py",
        ROOT.parent / "g2_case_pogo_flasher.py",
        ROOT.parent / "g2_case_rom.py",
        args.stock_image,
    ]
    frozen = {str(path.resolve()): sha(path.read_bytes()) for path in sources}
    cases = list(validate(validator, stock))
    cases.append(validate_baud_patch(baud_patch, args.baud))
    if frozen != {str(path.resolve()): sha(path.read_bytes()) for path in sources}:
        raise ValueError("schema-13 source/input changed during build")
    report = {
        "operation": "compiled-schema13-apollo510-stock-writer-case-bridge",
        "schemaVersion": 13,
        "passed": True,
        "bridgeBytes": len(bridge),
        "bridgeSha256": sha(bridge),
        "validatorBytes": len(validator),
        "validatorSha256": sha(validator),
        "validatorSlot": [hex(PATCH_START), hex(PATCH_END)],
        "nominalBaud": args.baud,
        "templeUartBrr": brr,
        "baudPatchBytes": len(baud_patch),
        "baudPatchSha256": sha(baud_patch),
        "baudPatchSlot": [hex(BAUD_PATCH_START), hex(BAUD_PATCH_END)],
        "baudPatchCallSites": [hex(value) for value in BAUD_CALL_SITES],
        "replacedHelloValidatorSha256": sha(original_region),
        "sourceHashes": frozen,
        "cases": cases,
        "caseBridgeMaximumRequestBytes": 1009,
        "caseBridgeMaximumDataBytes": 997,
        "stockImageBytes": len(stock),
        "stockImageSha256": sha(stock),
        "stockFirmwareVersion": stock_version,
        "stockImageCrc32": f"{stock_crc32:08x}",
        "hardwareExecuted": False,
        "firmwareImageBytesSent": 0,
        "transportExecutionImplemented": False,
        "boundary": (
            "Compiled Case bridge and emitted validator execute only in Unicorn. "
            "No USB, physical SBL, UART timing, descriptor, UPDATE, DATA, reset or MRAM write occurred."
        ),
    }
    (args.output / "validated-manifest.json").write_text(json.dumps(report, indent=2) + "\n")
    print(
        f"Completed {len(cases)} schema-13 cases; validator={len(validator)} bytes; "
        f"baud={args.baud}; hardware writes:0."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
