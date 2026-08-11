#!/usr/bin/env python3
"""Build SybilSight CFW 2.2.8.11 from official G2 2.2.8.4.

The reviewed 2.2.8.9 recipe contains two additions that are not present on the
upstream g2flash main branch: a direct advertised-name hook and the associated
``nameserial`` capability.  This builder starts with the official stock image,
replays only the reviewed g2flash rebase operations, restores the upstream
``EVENCFW/8`` capability marker, omits the advertised-name hook/blob entirely,
and recomputes every affected size and checksum.

The withdrawn 2.2.8.10 image is never used as build input.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import struct
import zlib


ROOT = Path(__file__).resolve().parents[1]
BASE = (
    ROOT
    / "public"
    / "firmware-updates"
    / "source-files"
    / "2.2.8.4"
    / "d495a1dffb919795e95135e144345f04.bin"
)
REBASE_RECIPE = (
    ROOT
    / "public"
    / "firmware-updates"
    / "source-files"
    / "2.2.8.9"
    / "cfw_patches-2.2.8.9.json"
)
OUTPUT_VERSION = "2.2.8.11"
OUTPUT_DIR = (
    ROOT / "public" / "firmware-updates" / "source-files" / OUTPUT_VERSION
)
OUTPUT_BUNDLE = OUTPUT_DIR / f"g2-{OUTPUT_VERSION}.bin"
OUTPUT_RECIPE = OUTPUT_DIR / f"cfw_patches-{OUTPUT_VERSION}.json"

APPLICATION_BASE = 0x00438000
APPLICATION_PREAMBLE = 0x20
APPLICATION_LOAD_BASE = APPLICATION_BASE - APPLICATION_PREAMBLE
RUNTIME_VERSION = b"2.2.8.11\0"
# The stock image stores its fixed-width version literals in a densely packed
# string table.  Since 2.2.8.11 is one byte longer than 2.2.8.4/2.2.8.9, the
# live consumers must point at a relocated, terminated string instead of
# overwriting the byte immediately following each old literal.
RUNTIME_VERSION_POINTERS = (
    (0x0046E708, 0x007964A4),
    (0x005ABB74, 0x007966BC),
    (0x0044ACF8, 0x00796CA4),
    (0x005D44F4, 0x00797934),
    (0x0049D71C, 0x00797C34),
    (0x00583D88, 0x00797EB4),
    (0x0046CA18, 0x0079834C),
    (0x004CE430, 0x00798974),
    (0x0047F074, 0x007989AC),
)
# This protocol response copies the old seven-character literal plus NUL into
# an eight-byte local before parsing it.  Redirecting it to an eight-character
# literal would drop the terminator, so update the emitted fourth component
# after parsing instead (``ldr r0, [sp, #0xc]`` -> ``movs r0, #11``).
NUMERIC_VERSION_REPORT_INSTRUCTION = 0x00575AD4
NUMERIC_VERSION_REPORT_OLD = bytes.fromhex("0398")
NUMERIC_VERSION_REPORT_NEW = bytes.fromhex("0b20")
EXPECTED_BASE_SHA256 = (
    "df7b8bd18727765eba73be5ab836e0ee4cfd17b5e680046003b8d608d2fbfda7"
)
EXPECTED_G2FLASH_COMMIT = "877c8d9490db0d3717ca012dd0f54556af3701bd"
EXPECTED_REBASE_SHA256 = (
    "fdf8fcb5de6a658105a1d45e1376c3932bc59d0dd278314c242572449f7bcdfb"
)
EXPECTED_ADVERTISED_HOOK_FILE_OFFSET = 1_000_085
EXPECTED_ADVERTISED_HOOK_STOCK = bytes.fromhex("fff74cff")
EXPECTED_ADVERTISED_BLOB_SHA256 = (
    "68036760a3e3485e9ce6e995b8fd1bfcfbdb3c0381b47b9d9cc4688bc825f694"
)
UPSTREAM_CAPABILITY = (
    b"EVENCFW/8 img576 img640 imgz rle wakelease directfb fbguard "
    b"wearnotify compass10"
)
ADVERTISED_CAPABILITY = UPSTREAM_CAPABILITY.replace(b"EVENCFW/8", b"EVENCFW/9") + (
    b" nameserial"
)


class BuildError(RuntimeError):
    pass


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


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


def decode_bl(site: int, encoded: bytes) -> int:
    if len(encoded) != 4:
        raise BuildError("advertised-name hook is not a four-byte Thumb BL")
    first, second = struct.unpack("<HH", encoded)
    sign = (first >> 10) & 1
    imm10 = first & 0x3FF
    j1 = (second >> 13) & 1
    j2 = (second >> 11) & 1
    imm11 = second & 0x7FF
    i1 = (~(j1 ^ sign)) & 1
    i2 = (~(j2 ^ sign)) & 1
    displacement = (
        (sign << 24) | (i1 << 23) | (i2 << 22) | (imm10 << 12) | (imm11 << 1)
    )
    if sign:
        displacement -= 1 << 25
    return site + 4 + displacement


def build() -> tuple[bytes, dict]:
    base = BASE.read_bytes()
    if sha256(base) != EXPECTED_BASE_SHA256:
        raise BuildError("official 2.2.8.4 base hash changed")
    source = json.loads(REBASE_RECIPE.read_text())
    if source.get("base_sha256") != EXPECTED_BASE_SHA256:
        raise BuildError("reviewed rebase recipe points at a different stock base")
    if source.get("g2flash_commit") != EXPECTED_G2FLASH_COMMIT:
        raise BuildError("reviewed rebase recipe points at a different g2flash commit")
    if source.get("g2flash_rebase_patch_sha256") != EXPECTED_REBASE_SHA256:
        raise BuildError("reviewed g2flash rebase digest changed")

    component_index, component_offset, stock_payload_size = find_main_application(base)
    payload_start = component_offset + 128
    payload_end = payload_start + stock_payload_size
    if payload_end != len(base):
        raise BuildError("Apollo main is no longer the final stock package component")

    advertised_hook = next(
        (
            operation
            for operation in source["patches"]
            if operation.get("desc")
            == "reviewed complete stock instruction for hook advertised_name"
        ),
        None,
    )
    append_operation = next(
        (operation for operation in source["patches"] if not operation.get("old")),
        None,
    )
    if (
        advertised_hook is None
        or advertised_hook["offset"] != EXPECTED_ADVERTISED_HOOK_FILE_OFFSET
        or bytes.fromhex(advertised_hook["old"]) != EXPECTED_ADVERTISED_HOOK_STOCK
        or append_operation is None
        or append_operation["offset"] != payload_end
    ):
        raise BuildError("reviewed advertised-name boundary changed")

    old_append = bytes.fromhex(append_operation["new"])
    append_address = APPLICATION_BASE + stock_payload_size - APPLICATION_PREAMBLE
    hook_site = APPLICATION_BASE + (
        EXPECTED_ADVERTISED_HOOK_FILE_OFFSET - payload_start
    ) - APPLICATION_PREAMBLE
    advertised_entry = decode_bl(hook_site, bytes.fromhex(advertised_hook["new"]))
    advertised_offset = advertised_entry - append_address
    if not 0 < advertised_offset < len(old_append):
        raise BuildError("advertised-name hook target is outside the appended blob")
    advertised_blob = old_append[advertised_offset:]
    if sha256(advertised_blob) != EXPECTED_ADVERTISED_BLOB_SHA256:
        raise BuildError("advertised-name blob boundary or bytes changed")

    upstream_blob = bytearray(old_append[:advertised_offset])
    capability_offset = upstream_blob.find(ADVERTISED_CAPABILITY)
    if capability_offset < 0 or upstream_blob.find(
        ADVERTISED_CAPABILITY, capability_offset + 1
    ) >= 0:
        raise BuildError("expected one nameserial capability marker in reviewed blob")
    replacement = UPSTREAM_CAPABILITY + b"\0"
    old_marker_span = len(ADVERTISED_CAPABILITY) + 1
    upstream_blob[capability_offset : capability_offset + old_marker_span] = (
        replacement + bytes(old_marker_span - len(replacement))
    )
    if b"nameserial" in upstream_blob or b"ble_advertised" in upstream_blob:
        raise BuildError("advertised-name material remains in the upstream blob")
    if upstream_blob.count(UPSTREAM_CAPABILITY) != 1:
        raise BuildError("upstream capability marker was not restored exactly once")

    upstream_blob.extend(bytes((-len(upstream_blob)) % 4))
    runtime_version_address = append_address + len(upstream_blob)
    runtime_version_blob_offset = len(upstream_blob)
    upstream_blob.extend(RUNTIME_VERSION)

    data = bytearray(base)
    operations: list[dict] = []

    def record(offset: int, replacement_bytes: bytes, description: str) -> None:
        replacement_bytes = bytes(replacement_bytes)
        old = bytes(base[offset : offset + len(replacement_bytes)])
        if bytes(data[offset : offset + len(replacement_bytes)]) != old:
            raise BuildError(f"overlapping operation at {offset:#x}")
        if old == replacement_bytes:
            return
        operations.append(
            {
                "offset": offset,
                "old": old.hex(),
                "new": replacement_bytes.hex(),
                "desc": description,
            }
        )
        data[offset : offset + len(replacement_bytes)] = replacement_bytes

    # Keep the outer package identity and every live application identity in
    # agreement.  The application strings are relocated below because the new
    # point-release component does not fit in the old fixed-width slots.
    record(60, b"11", "advance CFW package identity to 2.2.8.11")

    for operation in source["patches"]:
        description = operation.get("desc", "")
        if description.startswith("reviewed complete stock instruction for hook"):
            if description.endswith("advertised_name"):
                continue
            record(
                int(operation["offset"]),
                bytes.fromhex(operation["new"]),
                description,
            )
    for pointer_address, stock_target in RUNTIME_VERSION_POINTERS:
        pointer_offset = payload_start + (pointer_address - APPLICATION_LOAD_BASE)
        if struct.unpack_from("<I", base, pointer_offset)[0] != stock_target:
            raise BuildError(
                f"runtime-version pointer at {pointer_address:#x} no longer targets "
                f"{stock_target:#x}"
            )
        record(
            pointer_offset,
            struct.pack("<I", runtime_version_address),
            "redirect live firmware-version identity to CFW 2.2.8.11",
        )

    numeric_report_offset = payload_start + (
        NUMERIC_VERSION_REPORT_INSTRUCTION - APPLICATION_LOAD_BASE
    )
    if bytes(base[numeric_report_offset : numeric_report_offset + 2]) != (
        NUMERIC_VERSION_REPORT_OLD
    ):
        raise BuildError("numeric firmware-version response instruction changed")
    record(
        numeric_report_offset,
        NUMERIC_VERSION_REPORT_NEW,
        "report firmware point-release component 11 in the binary version response",
    )

    if bytes(data[EXPECTED_ADVERTISED_HOOK_FILE_OFFSET : EXPECTED_ADVERTISED_HOOK_FILE_OFFSET + 4]) != EXPECTED_ADVERTISED_HOOK_STOCK:
        raise BuildError("stock advertised-name call was not preserved")

    operations.append(
        {
            "offset": payload_end,
            "old": "",
            "new": bytes(upstream_blob).hex(),
            "desc": "append upstream g2flash main-branch CFW blob without BLE advertisement changes",
        }
    )
    data.extend(upstream_blob)
    new_payload_size = stock_payload_size + len(upstream_blob)

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
    if apply_operations(base, operations) != output:
        raise BuildError("stock replay recipe does not reproduce the output")
    if ADVERTISED_CAPABILITY in output or b"nameserial" in output:
        raise BuildError("BLE-advertisement capability remains in output")
    if output[
        EXPECTED_ADVERTISED_HOOK_FILE_OFFSET : EXPECTED_ADVERTISED_HOOK_FILE_OFFSET + 4
    ] != EXPECTED_ADVERTISED_HOOK_STOCK:
        raise BuildError("output changed the stock advertised-name call")
    runtime_version_file_offset = payload_end + runtime_version_blob_offset
    if output[
        runtime_version_file_offset : runtime_version_file_offset + len(RUNTIME_VERSION)
    ] != RUNTIME_VERSION:
        raise BuildError("relocated runtime identity was not emitted at its pinned offset")
    for pointer_address, _ in RUNTIME_VERSION_POINTERS:
        pointer_offset = payload_start + (pointer_address - APPLICATION_LOAD_BASE)
        if struct.unpack_from("<I", output, pointer_offset)[0] != runtime_version_address:
            raise BuildError(
                f"runtime-version pointer at {pointer_address:#x} was not redirected"
            )
    if output[numeric_report_offset : numeric_report_offset + 2] != (
        NUMERIC_VERSION_REPORT_NEW
    ):
        raise BuildError("binary firmware-version response was not updated")

    excluded_feature = {
        "id": "ble-advertised-name",
        "status": "omitted",
        "reason": "Not present on the pinned g2flash main branch and withdrawn after hardware failure evidence.",
        "preservedStockHookOffset": EXPECTED_ADVERTISED_HOOK_FILE_OFFSET,
        "preservedStockBytes": EXPECTED_ADVERTISED_HOOK_STOCK.hex(),
        "removedBlobSha256": EXPECTED_ADVERTISED_BLOB_SHA256,
    }
    source_provenance = {
        "direct_framebuffer_commits": [
            "235a8b304447e330df6a0bce0351e3b6dc3d6f08",
            "28aad42757837db14c08225884a7cc5201e08595",
        ],
        "excluded_feature": excluded_feature,
        "faceclaw_even_ai_resume_address": "0x004e6a92",
        "faceclaw_retained": True,
        "g2flash_rebase_patch_sha256": EXPECTED_REBASE_SHA256,
        "g2flash_upstream_commit": EXPECTED_G2FLASH_COMMIT,
        "hardware_validation": "not-yet-hardware-flashed",
        "implementation": (
            "jimrandomh/g2flash main-branch patch set applied to official stock; "
            "BLE advertisement modification omitted; runtime identity relocated "
            "to 2.2.8.11"
        ),
        "runtime_identity": {
            "address": f"0x{runtime_version_address:08x}",
            "numeric_report_instruction": (
                f"0x{NUMERIC_VERSION_REPORT_INSTRUCTION:08x}"
            ),
            "pointer_addresses": [
                f"0x{address:08x}" for address, _ in RUNTIME_VERSION_POINTERS
            ],
            "version": OUTPUT_VERSION,
        },
    }
    recipe = {
        "schemaVersion": 1,
        "base": BASE.name,
        "base_sha256": EXPECTED_BASE_SHA256,
        "base_version": "2.2.8.4",
        "capability_marker": UPSTREAM_CAPABILITY.decode("ascii"),
        "excluded_feature": excluded_feature,
        "g2flash_commit": EXPECTED_G2FLASH_COMMIT,
        "g2flash_rebase_patch_sha256": EXPECTED_REBASE_SHA256,
        "output": OUTPUT_BUNDLE.name,
        "output_sha256": sha256(output),
        "output_version": OUTPUT_VERSION,
        "patches": operations,
        "release_version": OUTPUT_VERSION,
        "source_provenance": source_provenance,
        "supersedes": "2.2.8.9",
        "replaces_withdrawn": "2.2.8.10",
        "vendor_base_version": "2.2.8.4",
    }
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
