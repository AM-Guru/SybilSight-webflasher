#!/usr/bin/env python3
"""Build the cold-start-safe G2 CFW successor from the reviewed 2.2.8.9 recipe.

The existing release redirects the PSN-to-manufacturer-data call, but stock
firmware copies the six BLE-MAC characters into the local name immediately
after that hook returns.  This builder appends the corrected final-copy hook,
redirects the later memcpy, advances the package identity to 2.2.8.10, and
emits a stock-2.2.8.4-based replay recipe.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import zlib


ROOT = Path(__file__).resolve().parents[1]
CFW_SOURCE = ROOT / "scripts" / "cfw"
BASE = (
    ROOT
    / "public"
    / "firmware-updates"
    / "source-files"
    / "2.2.8.4"
    / "d495a1dffb919795e95135e144345f04.bin"
)
PREVIOUS_DIR = (
    ROOT / "public" / "firmware-updates" / "source-files" / "2.2.8.9"
)
PREVIOUS_RECIPE = PREVIOUS_DIR / "cfw_patches-2.2.8.9.json"
PREVIOUS_BUNDLE = PREVIOUS_DIR / "g2-2.2.8.9.bin"
OUTPUT_VERSION = "2.2.8.10"
OUTPUT_DIR = (
    ROOT / "public" / "firmware-updates" / "source-files" / OUTPUT_VERSION
)
OUTPUT_BUNDLE = OUTPUT_DIR / f"g2-{OUTPUT_VERSION}.bin"
OUTPUT_RECIPE = OUTPUT_DIR / f"cfw_patches-{OUTPUT_VERSION}.json"

APPLICATION_BASE = 0x00438000
APPLICATION_PREAMBLE = 0x20
FINAL_COPY_SITE = 0x0046E472
FINAL_COPY_EXPECTED = bytes.fromhex("cbf7b7fb")
PREVIOUS_VERSION_MARKER = b"s200_v2.2.8.9\0"
NEW_VERSION_MARKER = b"s200_v2.2.8.10"


class BuildError(RuntimeError):
    pass


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise BuildError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def apply_operations(image: bytes, operations: list[dict]) -> bytes:
    data = bytearray(image)
    for index, operation in enumerate(operations):
        offset = int(operation["offset"])
        old = bytes.fromhex(operation.get("old", ""))
        new = bytes.fromhex(operation["new"])
        if old:
            current = bytes(data[offset : offset + len(old)])
            if current != old:
                raise BuildError(
                    f"operation {index} at {offset:#x} expected {old.hex()}, "
                    f"found {current.hex()}"
                )
            data[offset : offset + len(new)] = new
        else:
            if offset != len(data):
                raise BuildError(
                    f"operation {index} append offset {offset:#x} != {len(data):#x}"
                )
            data.extend(new)
    return bytes(data)


def find_main_application(image: bytes) -> tuple[int, int, int]:
    count = struct.unpack_from("<I", image, 8)[0]
    for index in range(count):
        _, offset, _, _ = struct.unpack_from("<IIII", image, 0x40 + index * 16)
        name = image[offset + 48 : offset + 128].split(b"\0", 1)[0]
        if name.endswith(b"s200_firmware_ota.bin"):
            payload_size = struct.unpack_from("<I", image, offset + 8)[0]
            return index, offset, payload_size
    raise BuildError("Apollo main component not found")


def encode_bl(site: int, target: int) -> bytes:
    displacement = target - (site + 4)
    if displacement % 2 or not -(1 << 24) <= displacement < (1 << 24):
        raise BuildError(f"BL {site:#x}->{target:#x} is not encodable")
    immediate = (displacement >> 1) & 0xFFFFFF
    sign = (immediate >> 23) & 1
    i1 = (immediate >> 22) & 1
    i2 = (immediate >> 21) & 1
    imm10 = (immediate >> 11) & 0x3FF
    imm11 = immediate & 0x7FF
    j1 = (~(i1 ^ sign)) & 1
    j2 = (~(i2 ^ sign)) & 1
    first = 0xF000 | (sign << 10) | imm10
    second = 0xD000 | (j1 << 13) | (j2 << 11) | imm11
    return struct.pack("<HH", first, second)


def crc32c_msb(data: bytes) -> int:
    table = []
    for value in range(256):
        crc = value << 24
        for _ in range(8):
            crc = (
                ((crc << 1) ^ 0x1EDC6F41) & 0xFFFFFFFF
                if crc & 0x80000000
                else (crc << 1) & 0xFFFFFFFF
            )
        table.append(crc)
    crc = 0
    for value in data:
        crc = ((crc << 8) & 0xFFFFFFFF) ^ table[((crc >> 24) ^ value) & 0xFF]
    return crc


def compile_hook() -> tuple[bytes, int, dict[str, str]]:
    integration = load_module(
        "webflasher_ble_advertised_name",
        CFW_SOURCE / "ble_advertised_name.py",
    )
    profile = integration.stock_profile("2.2.8.4")
    command = [
        "python3",
        str(CFW_SOURCE / "build.py"),
        str(CFW_SOURCE / "ble_advertised_name.c"),
        "--json",
        *integration.compiler_defines(profile),
    ]
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    built = json.loads(result.stdout)
    function = next(
        item
        for item in built["functions"]
        if item["name"] == integration.ENTRY_FUNCTION
    )
    if built.get("rodata_len", 0) != 0:
        raise BuildError("advertised-name hook unexpectedly gained rodata")
    sources = {
        path.name: sha256(path.read_bytes())
        for path in (
            CFW_SOURCE / "ble_advertised_name.c",
            CFW_SOURCE / "ble_advertised_name.py",
        )
    }
    return bytes.fromhex(built["text"]), int(function["offset"]), sources


def build() -> tuple[bytes, dict]:
    base = BASE.read_bytes()
    previous_recipe = json.loads(PREVIOUS_RECIPE.read_text())
    if sha256(base) != previous_recipe["base_sha256"]:
        raise BuildError("reviewed 2.2.8.4 base hash changed")
    data = bytearray(apply_operations(base, previous_recipe["patches"]))
    if sha256(data) != previous_recipe["output_sha256"]:
        raise BuildError("2.2.8.9 recipe no longer reproduces its pinned output")
    if bytes(data) != PREVIOUS_BUNDLE.read_bytes():
        raise BuildError("2.2.8.9 bundle differs from its replay recipe")

    hook, function_offset, source_hashes = compile_hook()
    extra_operations: list[dict] = []

    def record(offset: int, replacement: bytes, description: str) -> None:
        old = bytes(data[offset : offset + len(replacement)])
        if old == replacement:
            return
        extra_operations.append(
            {
                "offset": offset,
                "old": old.hex(),
                "new": replacement.hex(),
                "desc": description,
            }
        )
        data[offset : offset + len(replacement)] = replacement

    marker_position = data.find(PREVIOUS_VERSION_MARKER)
    if marker_position < 0 or data.find(PREVIOUS_VERSION_MARKER, marker_position + 1) >= 0:
        raise BuildError("expected one packed G2 package version marker")
    record(
        marker_position,
        NEW_VERSION_MARKER,
        "advance reviewed CFW package identity to 2.2.8.10",
    )

    component_index, component_offset, old_payload_size = find_main_application(data)
    payload_start = component_offset + 128
    call_offset = (
        payload_start
        + APPLICATION_PREAMBLE
        + FINAL_COPY_SITE
        - APPLICATION_BASE
    )
    if bytes(data[call_offset : call_offset + 4]) != FINAL_COPY_EXPECTED:
        raise BuildError("final advertised-name suffix copy call changed")

    padding = (-old_payload_size) % 4
    append = bytes(padding) + hook
    hook_payload_offset = old_payload_size + padding
    hook_address = (
        APPLICATION_BASE + hook_payload_offset - APPLICATION_PREAMBLE + function_offset
    )
    record(
        call_offset,
        encode_bl(FINAL_COPY_SITE, hook_address),
        "redirect final BLE-MAC suffix copy to validated pair serial hook",
    )

    payload_end = payload_start + old_payload_size
    if payload_end != len(data):
        raise BuildError("Apollo main is no longer the final package component")
    extra_operations.append(
        {
            "offset": payload_end,
            "old": "",
            "new": append.hex(),
            "desc": "append cold-start-safe advertised-name final-copy hook",
        }
    )
    data.extend(append)
    new_payload_size = old_payload_size + len(append)

    record(
        component_offset + 8,
        struct.pack("<I", new_payload_size),
        "main-app subheader payload size",
    )
    record(
        0x40 + component_index * 16 + 8,
        struct.pack("<I", new_payload_size + 128),
        "main-app TOC entry size",
    )
    preamble_word = struct.unpack_from("<I", data, payload_start)[0]
    record(
        payload_start,
        struct.pack(
            "<I", (preamble_word & 0xFF000000) | (new_payload_size & 0xFFFFFF)
        ),
        "main-app preamble length",
    )
    preamble_crc = zlib.crc32(
        bytes(data[payload_start + 8 : payload_start + new_payload_size])
    ) & 0xFFFFFFFF
    record(
        payload_start + 4,
        struct.pack("<I", preamble_crc),
        "main-app preamble crc32",
    )
    component_crc = crc32c_msb(
        bytes(data[payload_start : payload_start + new_payload_size])
    )
    record(
        0x40 + component_index * 16 + 12,
        struct.pack("<I", component_crc),
        "main-app component crc32c (TOC)",
    )
    record(
        component_offset + 12,
        struct.pack("<I", component_crc),
        "main-app component crc32c (subheader)",
    )

    output = bytes(data)
    operations = [*previous_recipe["patches"], *extra_operations]
    if apply_operations(base, operations) != output:
        raise BuildError("combined stock replay recipe does not reproduce output")

    hook_sha = sha256(hook)
    provenance = dict(previous_recipe.get("source_provenance", {}))
    provenance.update(
        {
            "ble_advertising_patch_sha256": hook_sha,
            "ble_advertising_sources": source_hashes,
            "hardware_validation": "not-yet-hardware-flashed",
            "implementation": (
                "jimrandomh/g2flash patch set plus final-copy BLE name fix"
            ),
        }
    )
    recipe = dict(previous_recipe)
    recipe.update(
        {
            "release_version": OUTPUT_VERSION,
            "output_version": OUTPUT_VERSION,
            "output": OUTPUT_BUNDLE.name,
            "output_sha256": sha256(output),
            "ble_advertising_patch_sha256": hook_sha,
            "ble_advertising_sources": source_hashes,
            "patches": operations,
            "source_provenance": provenance,
            "supersedes": "2.2.8.9",
        }
    )
    return output, recipe


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    arguments = parser.parse_args()
    output, recipe = build()
    output_dir = arguments.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    bundle_path = output_dir / OUTPUT_BUNDLE.name
    recipe_path = output_dir / OUTPUT_RECIPE.name
    bundle_path.write_bytes(output)
    recipe_path.write_text(json.dumps(recipe, indent=2) + "\n")
    print(f"wrote {bundle_path} ({len(output)} bytes, sha256 {sha256(output)})")
    print(
        f"wrote {recipe_path} ({len(recipe['patches'])} operations, "
        f"sha256 {sha256(recipe_path.read_bytes())})"
    )


if __name__ == "__main__":
    main()
