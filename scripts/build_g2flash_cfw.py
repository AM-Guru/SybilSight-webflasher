#!/usr/bin/env python3
"""Build G2 CFW 2.2.6.11 from stock 2.2.6.10 and upstream g2flash.

The builder consumes the exact expected-byte-gated patch recipe committed in a
local g2flash checkout, advances the package and two live runtime identities to
2.2.6.11, and regenerates the affected Apollo checksums.  It emits both the
flashable EVENOTA bundle and a stock-replay recipe for archival verification.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import zlib


ROOT = Path(__file__).resolve().parents[1]
BASE_VERSION = "2.2.6.10"
OUTPUT_VERSION = "2.2.6.11"
EXPECTED_RELEASE_SHA256 = (
    "105032302d02ccf943b785070cf15877a918c120b7ca1332bb6261f70eb6d683"
)
ARCHIVE_KEY = f"{OUTPUT_VERSION}-{EXPECTED_RELEASE_SHA256[:12]}"
BASE = (
    ROOT
    / "public"
    / "firmware-updates"
    / "source-files"
    / BASE_VERSION
    / "e28738432d7b612d625331b00383149b.bin"
)
OUTPUT_DIR = (
    ROOT / "public" / "firmware-updates" / "source-files" / ARCHIVE_KEY
)
OUTPUT_BUNDLE = f"g2-{OUTPUT_VERSION}.bin"
OUTPUT_RECIPE = f"cfw_patches-{OUTPUT_VERSION}.json"

EXPECTED_BASE_SHA256 = (
    "f4dfb0b49ad3de3c2daf17f8a27a157c3dc98411d6a0d3ab2cfd0918f41b9afa"
)
EXPECTED_G2FLASH_COMMIT = "877c8d9490db0d3717ca012dd0f54556af3701bd"
EXPECTED_G2FLASH_PATCH_SHA256 = (
    "ab38d6299ba28afe2cd4ea5b4442867e894b7909e6c73db8f1ee0796c06a914a"
)
EXPECTED_G2FLASH_OUTPUT_SHA256 = (
    "20cba9377ea207c8c0a6fd936f32db9ecaf23da023cdf43a770b22b355107d1f"
)
CAPABILITY_MARKER = (
    "EVENCFW/8 img576 img640 imgz rle wakelease directfb fbguard "
    "wearnotify compass10"
)
IDENTITY_PATCHES = (
    (48, b"s200_v2.2.6.10", b"s200_v2.2.6.11", "package identity s200_v2.2.6.11"),
    (
        4_265_539,
        b"2.2.6.10",
        b"2.2.6.11",
        "settings-reported CFW version 2.2.6.11",
    ),
    (
        4_266_955,
        b"2.2.6.10",
        b"2.2.6.11",
        "product-test 0x24 CFW version 2.2.6.11",
    ),
)
CHECKSUM_DESCRIPTIONS = {
    "[5] ota/s200_firmware_ota.bin preamble crc32",
    "[5] ota/s200_firmware_ota.bin component crc32c (TOC)",
    "[5] ota/s200_firmware_ota.bin component crc32c (subheader)",
}


class BuildError(RuntimeError):
    pass


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


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
            if len(old) != len(new):
                raise BuildError(f"operation {index} changes an in-place length")
            data[offset : offset + len(new)] = new
        else:
            if offset != len(data):
                raise BuildError(
                    f"operation {index} append offset {offset:#x} != {len(data):#x}"
                )
            data.extend(new)
    return bytes(data)


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


def find_main_application(image: bytes) -> tuple[int, int, int, int]:
    count = struct.unpack_from("<I", image, 8)[0]
    for index in range(count):
        _, component_offset, _, _ = struct.unpack_from(
            "<IIII", image, 0x40 + index * 16
        )
        name = image[component_offset + 48 : component_offset + 128].split(
            b"\0", 1
        )[0]
        if name.endswith(b"s200_firmware_ota.bin"):
            payload_size = struct.unpack_from("<I", image, component_offset + 8)[0]
            return index, component_offset, component_offset + 128, payload_size
    raise BuildError("Apollo main component not found")


def g2flash_commit(checkout: Path) -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=checkout,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError) as error:
        raise BuildError(f"cannot identify g2flash checkout: {error}") from error


def build(g2flash: Path) -> tuple[bytes, dict]:
    base = BASE.read_bytes()
    if sha256(base) != EXPECTED_BASE_SHA256:
        raise BuildError("official 2.2.6.10 base hash changed")

    patch_path = g2flash / "patches" / "cfw_patches.json"
    patch_bytes = patch_path.read_bytes()
    if sha256(patch_bytes) != EXPECTED_G2FLASH_PATCH_SHA256:
        raise BuildError("g2flash patch recipe is not the reviewed main-branch recipe")
    commit = g2flash_commit(g2flash)
    if commit != EXPECTED_G2FLASH_COMMIT:
        raise BuildError(
            f"g2flash checkout is {commit}, expected {EXPECTED_G2FLASH_COMMIT}"
        )

    upstream = json.loads(patch_bytes)
    if upstream.get("base_sha256") != EXPECTED_BASE_SHA256:
        raise BuildError("g2flash patch recipe targets a different stock base")
    if upstream.get("output_sha256") != EXPECTED_G2FLASH_OUTPUT_SHA256:
        raise BuildError("g2flash patch recipe has an unexpected output digest")
    upstream_output = apply_operations(base, upstream["patches"])
    if sha256(upstream_output) != EXPECTED_G2FLASH_OUTPUT_SHA256:
        raise BuildError("g2flash patch recipe did not reproduce its pinned output")
    if upstream_output.count(CAPABILITY_MARKER.encode("ascii")) != 1:
        raise BuildError("g2flash capability marker is missing or duplicated")

    data = bytearray(upstream_output)
    for offset, old, new, _ in IDENTITY_PATCHES:
        if bytes(data[offset : offset + len(old)]) != old:
            raise BuildError(f"firmware identity at {offset:#x} changed")
        data[offset : offset + len(new)] = new

    component_index, component_offset, payload_start, payload_size = (
        find_main_application(data)
    )
    preamble_crc = zlib.crc32(
        bytes(data[payload_start + 8 : payload_start + payload_size])
    ) & 0xFFFFFFFF
    struct.pack_into("<I", data, payload_start + 4, preamble_crc)
    component_crc = crc32c_msb(
        bytes(data[payload_start : payload_start + payload_size])
    )
    toc_crc_offset = 0x40 + component_index * 16 + 12
    subheader_crc_offset = component_offset + 12
    struct.pack_into("<I", data, toc_crc_offset, component_crc)
    struct.pack_into("<I", data, subheader_crc_offset, component_crc)
    output = bytes(data)

    operations = [
        dict(operation)
        for operation in upstream["patches"]
        if operation.get("desc") not in CHECKSUM_DESCRIPTIONS
    ]
    operations.extend(
        {
            "offset": offset,
            "old": old.hex(),
            "new": new.hex(),
            "desc": description,
        }
        for offset, old, new, description in IDENTITY_PATCHES
    )
    operations.extend(
        [
            {
                "offset": payload_start + 4,
                "old": base[payload_start + 4 : payload_start + 8].hex(),
                "new": struct.pack("<I", preamble_crc).hex(),
                "desc": "[5] ota/s200_firmware_ota.bin preamble crc32",
            },
            {
                "offset": toc_crc_offset,
                "old": base[toc_crc_offset : toc_crc_offset + 4].hex(),
                "new": struct.pack("<I", component_crc).hex(),
                "desc": "[5] ota/s200_firmware_ota.bin component crc32c (TOC)",
            },
            {
                "offset": subheader_crc_offset,
                "old": base[subheader_crc_offset : subheader_crc_offset + 4].hex(),
                "new": struct.pack("<I", component_crc).hex(),
                "desc": "[5] ota/s200_firmware_ota.bin component crc32c (subheader)",
            },
        ]
    )
    replayed = apply_operations(base, operations)
    if replayed != output:
        raise BuildError("stock replay recipe does not reproduce the output")
    if sha256(output) != EXPECTED_RELEASE_SHA256:
        raise BuildError("release output does not match its content-addressed archive key")
    if output.count(b"2.2.6.11") != len(IDENTITY_PATCHES):
        raise BuildError("2.2.6.11 identity count is not exactly three")

    source_provenance = {
        "direct_framebuffer_commits": [
            "235a8b304447e330df6a0bce0351e3b6dc3d6f08",
            "28aad42757837db14c08225884a7cc5201e08595",
        ],
        "g2flash_upstream_commit": commit,
        "g2flash_patch_sha256": EXPECTED_G2FLASH_PATCH_SHA256,
        "g2flash_output_sha256": EXPECTED_G2FLASH_OUTPUT_SHA256,
        "identity_strategy": "same-width package and two live runtime string updates",
        "hardware_validation": "not-yet-hardware-flashed",
    }
    recipe = {
        "schemaVersion": 1,
        "base": BASE.name,
        "base_sha256": EXPECTED_BASE_SHA256,
        "base_version": BASE_VERSION,
        "capability_marker": CAPABILITY_MARKER,
        "g2flash_commit": commit,
        "g2flash_patch_sha256": EXPECTED_G2FLASH_PATCH_SHA256,
        "g2flash_output_sha256": EXPECTED_G2FLASH_OUTPUT_SHA256,
        "output": OUTPUT_BUNDLE,
        "output_sha256": sha256(output),
        "output_version": OUTPUT_VERSION,
        "patches": operations,
        "release_version": OUTPUT_VERSION,
        "source_provenance": source_provenance,
        "vendor_base_version": BASE_VERSION,
    }
    return output, recipe


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--g2flash",
        type=Path,
        default=Path.home() / "Repo" / "g2flash",
        help="reviewed g2flash checkout (default: ~/Repo/g2flash)",
    )
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    arguments = parser.parse_args()
    output, recipe = build(arguments.g2flash.resolve())
    output_dir = arguments.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    bundle_path = output_dir / OUTPUT_BUNDLE
    recipe_path = output_dir / OUTPUT_RECIPE
    bundle_path.write_bytes(output)
    recipe_path.write_text(json.dumps(recipe, indent=2) + "\n")
    print(f"wrote {bundle_path} ({len(output)} bytes, sha256 {sha256(output)})")
    print(
        f"wrote {recipe_path} ({len(recipe['patches'])} operations, "
        f"sha256 {sha256(recipe_path.read_bytes())})"
    )


if __name__ == "__main__":
    main()
