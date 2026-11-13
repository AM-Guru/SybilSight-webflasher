"""Inspect a schema-13 stock-writer bridge without opening hardware."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import zlib

from case_native_task_recovery.build import encode_bl
from case_sbl_stock_writer.build import (
    BAUD_CALL_SITES,
    BAUD_PATCH_END,
    BAUD_PATCH_START,
    PATCH_END,
    PATCH_START,
)
from case_sbl_stock_writer.stock_release import expected_stock_version
from g2_case_pogo_flasher import BRIDGE_BYTES, build_sbl_hello_probe_bridge
from g2_case_rom import SRAM_ADDRESS


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def inspect(
    build: Path, stock_image: Path, *, expected_baud: int | None = None
) -> tuple[dict[str, object], bytes]:
    manifest = json.loads((build / "validated-manifest.json").read_text())
    bridge = (build / "bridge.bin").read_bytes()
    validator = (build / "validator.bin").read_bytes()
    baud_patch = (build / "baud_patch.bin").read_bytes()
    stock = stock_image.read_bytes()

    if (
        manifest.get("operation") != "compiled-schema13-apollo510-stock-writer-case-bridge"
        or manifest.get("schemaVersion") != 13
        or manifest.get("passed") is not True
    ):
        raise ValueError("schema-13 manifest identity differs")
    if (
        len(bridge) != BRIDGE_BYTES
        or manifest.get("bridgeBytes") != len(bridge)
        or manifest.get("bridgeSha256") != _sha(bridge)
        or manifest.get("validatorBytes") != len(validator)
        or manifest.get("validatorSha256") != _sha(validator)
        or manifest.get("validatorSlot") != [hex(PATCH_START), hex(PATCH_END)]
        or manifest.get("baudPatchBytes") != len(baud_patch)
        or manifest.get("baudPatchSha256") != _sha(baud_patch)
        or manifest.get("baudPatchSlot") != [hex(BAUD_PATCH_START), hex(BAUD_PATCH_END)]
        or manifest.get("baudPatchCallSites") != [hex(value) for value in BAUD_CALL_SITES]
        or manifest.get("nominalBaud") not in (115_200, 1_000_000)
        or manifest.get("templeUartBrr") != (
            556 if manifest.get("nominalBaud") == 115_200 else 64
        )
        or (expected_baud is not None and manifest.get("nominalBaud") != expected_baud)
    ):
        raise ValueError("schema-13 emitted artifact identity differs")

    expected = bytearray(build_sbl_hello_probe_bridge())
    for site in BAUD_CALL_SITES:
        expected[site:site + 4] = encode_bl(
            SRAM_ADDRESS + site, SRAM_ADDRESS + BAUD_PATCH_START
        )
    expected[BAUD_PATCH_START:BAUD_PATCH_END] = baud_patch + bytes.fromhex("00bf") * (
        (BAUD_PATCH_END - BAUD_PATCH_START - len(baud_patch)) // 2
    )
    expected[PATCH_START:PATCH_END] = validator + bytes.fromhex("00bf") * (
        (PATCH_END - PATCH_START - len(validator)) // 2
    )
    if bridge != bytes(expected):
        raise ValueError("schema-13 bridge is not the exact reviewed derivative")

    current_sources = {
        name: _sha(Path(name).read_bytes())
        for name in manifest.get("sourceHashes", {})
    }
    if current_sources != manifest.get("sourceHashes"):
        raise ValueError("schema-13 source or input changed after build")
    if (
        manifest.get("stockImageBytes") != len(stock)
        or manifest.get("stockImageSha256") != _sha(stock)
        or manifest.get("stockFirmwareVersion") != expected_stock_version(_sha(stock))
        or manifest.get("stockImageCrc32") != f"{zlib.crc32(stock) & 0xffffffff:08x}"
        or manifest.get("caseBridgeMaximumRequestBytes") != 1009
        or manifest.get("caseBridgeMaximumDataBytes") != 997
    ):
        raise ValueError("schema-13 stock image or bridge bounds differ")

    cases = manifest.get("cases", [])
    if len(cases) != 29 or not all(row.get("passed") is True for row in cases):
        raise ValueError("schema-13 validation coverage differs")
    if (
        manifest.get("hardwareExecuted") is not False
        or manifest.get("firmwareImageBytesSent") != 0
        or manifest.get("transportExecutionImplemented") is not False
    ):
        raise ValueError("schema-13 proof boundary differs")
    return manifest, bridge


__all__ = ["inspect"]
