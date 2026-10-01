"""Audit an emitted 230.27 recipe against the exact 230.26 recipe.

Adapted from audit_revision29_emitted.py. Every stock patch site keeps its
offset, expected stock bytes and description; there is exactly one appended
payload at the same offset; and every hook whose new bytes changed is either
size/checksum metadata or a Thumb-2 BL/B.W or code pointer that still lands
inside the appended injected payload. Nothing is written or flashed.
"""
from __future__ import annotations

import json
from pathlib import Path

METADATA = {
    "main-app subheader payload size (ps)",
    "main-app TOC entry size (ps + 128)",
    "main-app preamble length (low 24 bits)",
    "[5] ota/s200_firmware_ota.bin preamble crc32",
    "[5] ota/s200_firmware_ota.bin component crc32c (TOC)",
    "[5] ota/s200_firmware_ota.bin component crc32c (subheader)",
}


def thumb_branch_target(address: int, code: bytes) -> int | None:
    """Target of a 32-bit Thumb-2 BL/B.W (T4) at `address`, else None."""
    if len(code) != 4:
        return None
    hw1 = code[0] | code[1] << 8
    hw2 = code[2] | code[3] << 8
    if hw1 & 0xF800 != 0xF000 or hw2 & 0x9000 != 0x9000:
        return None
    s = (hw1 >> 10) & 1
    i1 = 1 - (((hw2 >> 13) & 1) ^ s)
    i2 = 1 - (((hw2 >> 11) & 1) ^ s)
    imm = s << 24 | i1 << 23 | i2 << 22 | (hw1 & 0x3FF) << 12 | (hw2 & 0x7FF) << 1
    if s:
        imm -= 1 << 25
    return address + 4 + imm


def audit(parent: dict, current: dict, file_delta: int) -> dict:
    if parent["base_sha256"] != current["base_sha256"]:
        raise ValueError("Recipe donor hash changed")
    anchors = lambda recipe: [(p["offset"], p["old"], p["desc"]) for p in recipe["patches"]]
    if anchors(parent) != anchors(current):
        raise ValueError("Firmware patch sites, expected old bytes, or descriptions changed")
    appended = [p for p in current["patches"] if p["old"] == ""]
    prior = [p for p in parent["patches"] if p["old"] == ""]
    if len(appended) != 1 or len(prior) != 1 or appended[0]["offset"] != prior[0]["offset"]:
        raise ValueError("Expected one appended payload at the parent offset")
    blob_start = appended[0]["offset"] + file_delta
    blob_end = blob_start + len(bytes.fromhex(appended[0]["new"]))
    retargeted, metadata = [], []
    for old, new in zip(parent["patches"], current["patches"]):
        if not old["old"] or old["new"] == new["new"]:
            continue
        if new["desc"] in METADATA:
            metadata.append(new["desc"])
            continue
        code = bytes.fromhex(new["new"])
        address = new["offset"] + file_delta
        target = thumb_branch_target(address, code)
        if target is None and len(code) == 4:
            target = int.from_bytes(code, "little") & ~1
        if target is None or not blob_start <= target < blob_end:
            raise ValueError("A changed hook no longer targets the injected payload: " + new["desc"])
        retargeted.append(new["desc"])
    expected_metadata = METADATA
    if len(bytes.fromhex(prior[0]["new"])) == blob_end - blob_start:
        # Equal-sized rebuilds retain all three length fields. Requiring them
        # to change would reject a valid image without adding an integrity check.
        expected_metadata = METADATA - {
            "main-app subheader payload size (ps)",
            "main-app TOC entry size (ps + 128)",
            "main-app preamble length (low 24 bits)",
        }
    if set(metadata) != expected_metadata:
        raise ValueError("Unexpected metadata change set: " + repr(metadata))
    return {
        "patchSites": len(current["patches"]),
        "sameOffsetsOldBytesAndDescriptions": True,
        "appendOffset": appended[0]["offset"],
        "parentAppendBytes": len(bytes.fromhex(prior[0]["new"])),
        "appendBytes": blob_end - blob_start,
        "retargetedHooksInsidePayload": len(retargeted),
        "changedMetadata": sorted(metadata),
    }


def audit_files(parent_recipe: Path, recipe: Path, abi: Path) -> dict:
    delta = int(json.loads(abi.read_text())["file_delta"], 16)
    return audit(json.loads(parent_recipe.read_text()), json.loads(recipe.read_text()), delta)
