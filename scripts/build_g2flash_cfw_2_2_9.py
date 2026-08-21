#!/usr/bin/env python3
"""Build SybilSight G2 CFW 2.2.9.25 from official 2.2.9.22.

The injected feature code is compiled from the pinned g2flash main checkout after
applying the reviewed 2.2.9 address profile in memory.  Every live-code edit is
expected-byte gated, all package/runtime identities are advanced to 2.2.9.25,
and the emitted JSON recipe reproduces the output from the stock CDN image.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import zlib


ROOT = Path(__file__).resolve().parents[1]
BASE_VERSION = "2.2.9.22"
OUTPUT_VERSION = "2.2.9.25"
BASE_SHA256 = "a03fbea9f68a9de6bc271daabb9f3a41c59053d1086622c76a4e990f829cc561"
G2FLASH_COMMIT = "469d78e332040f6ed77e978df496d3e7d427b4f2"
G2FLASH_RECIPE_SHA256 = "fe76eb55a6a52eec06f0818e56e310ab419731169b12305aed755a7318419410"
CAPABILITY_MARKER = (
    "EVENCFW/16 img576 img640 imgz rle wakelease directfb fbguard "
    "wearnotify compass10 cleanup11 texcache12 teximg13 texstr14 font15 "
    "buzzer5 diag7 multiseg8 rectcopy9 ringhold"
)
UPSTREAM_CAPABILITY_MARKER = (
    "EVENCFW/15 img576 img640 imgz rle wakelease directfb fbguard "
    "wearnotify compass10 cleanup11 texcache12 teximg13 texstr14 font15"
)
BASE = (
    ROOT / "public" / "firmware-updates" / "source-files" / BASE_VERSION
    / "fc250b05e98a9ff998b4b68f5f99f994.bin"
)
DEFAULT_OUTPUT_DIR = (
    ROOT / "public" / "firmware-updates" / "source-files" / OUTPUT_VERSION
)
APP_LOAD_ADDR = 0x00438000
APP_PREAMBLE = 0x20
APP_MAX_END = 0x007F0000


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


def enc_branch(pc: int, target: int, *, link: bool) -> bytes:
    displacement = target - (pc + 4)
    if displacement % 2 or not -(1 << 24) <= displacement < (1 << 24):
        raise BuildError(f"Thumb branch {pc:#x}->{target:#x} is out of range")
    immediate = (displacement >> 1) & 0xFFFFFF
    sign = (immediate >> 23) & 1
    i1 = (immediate >> 22) & 1
    i2 = (immediate >> 21) & 1
    imm10 = (immediate >> 11) & 0x3FF
    imm11 = immediate & 0x7FF
    j1 = (~(i1 ^ sign)) & 1
    j2 = (~(i2 ^ sign)) & 1
    first = 0xF000 | (sign << 10) | imm10
    second = (0xD000 if link else 0x9000) | (j1 << 13) | (j2 << 11) | imm11
    return struct.pack("<HH", first, second)


def find_main_application(image: bytes) -> tuple[int, int, int, int]:
    count = struct.unpack_from("<I", image, 8)[0]
    for index in range(count):
        _, component_offset, _, _ = struct.unpack_from(
            "<IIII", image, 0x40 + index * 16
        )
        name = image[component_offset + 48 : component_offset + 128].split(b"\0", 1)[0]
        if name.endswith(b"s200_firmware_ota.bin"):
            payload_size = struct.unpack_from("<I", image, component_offset + 8)[0]
            return index, component_offset, component_offset + 128, payload_size
    raise BuildError("Apollo main component not found")


def checked_replace(text: str, old: str, new: str, source: str) -> str:
    count = text.count(old)
    if count == 0:
        raise BuildError(f"{source}: expected profile token is absent: {old}")
    return text.replace(old, new)


ADDRESS_PROFILE = {
    "0x00475b15": "0x0047d809", "0x00475c1b": "0x0047d90f",
    "0x00490121": "0x0049da09", "0x00464b2f": "0x0046a39f",
    "0x0045a569": "0x0045cfdd", "0x0049eb8f": "0x004ac333",
    "0x0045f8fd": "0x004622ed", "0x0045f8e7": "0x004622d7",
    "0x004da16b": "0x004ebad3", "0x00474cd3": "0x0047c9c7",
    "0x00474d17": "0x0047ca0b", "0x005beac3": "0x005d6167",
    "0x005beb91": "0x005d6235", "0x005bea87": "0x005d612b",
    "0x004dc5af": "0x004ee3bb", "0x0047510f": "0x0047ce03",
    "0x00498681": "0x004a60c1", "0x00440657": "0x00440d9b",
    "0x00502b5b": "0x00516f0b", "0x00502bf9": "0x00516fa9",
    "0x00502ac5": "0x00516e75", "0x00502c89": "0x00517039",
    "0x00449499": "0x00442c4d", "0x004493b1": "0x00442b65",
    "0x004494d9": "0x00442c8d", "0x004e0cbb": "0x004f3d87",
    "0x004e0ccf": "0x004f3d9b", "0x004da383": "0x004ebd09",
    "0x0047381f": "0x00479483", "0x0047386b": "0x004794cf",
    "0x00474067": "0x00479d83", "0x0046ca15": "0x004708d1",
    "0x005455e5": "0x0055d4d7", "0x0054566d": "0x0055d55f",
    "0x0058705d": "0x0059f487", "0x200007b8": "0x200008b4",
    "0x20074504": "0x200767a0", "0x20074a34": "0x20076d80",
    "0x200744d0": "0x20076768", "0x2034dc30": "0x20349450",
    "0x20003ffc": "0x2000475c", "0x0044953f": "0x00442cf3",
    "0x0046ae9d": "0x004eb031", "0x00484181": "0x0048c1e9",
    "0x0048429f": "0x0048c307", "0x004d5613": "0x004e644f",
    "0x004d5665": "0x004e64a1", "0x004d56c1": "0x004e64fd",
    "0x0078d654": "0x007b75f8", "0x20000338": "0x2000033c",
    "0x20000354": "0x20000358", "0x20074254": "0x200765a0",
    "0x200746dc": "0x20076978", "0x20074abc": "0x20076e08",
    "0x2013be70": "0x201350a8", "0x20208e70": "0x202020a8",
    "0x20279670": "0x202728a8", "0x202a6270": "0x2029f4a8",
    "0x202a6274": "0x2029f4ac", "0x202a6670": "0x2029f8a8",
}


HOOKS = (
    (0x00444A74, "25f093fc", "evenhub_longpress", "tap-then-long-press forwarding"),
    (0x00444D36, "1df0d9fa", "ring_release", "ring long-press release forwarding"),
    (0x00444DFC, "1df076fa", "compass_event_forward", "global compass forwarding"),
    (0x0045F146, "0bf02af9", "faceclaw_display_start", "local display-start lease"),
    (0x0045F206, "0bf0caf8", "faceclaw_display_start", "mirrored display-start lease"),
    (0x004798F2, "f6f7edff", "display_copy_hook", "type-3 direct framebuffer copy"),
    (0x00479A2E, "f6f74fff", "display_copy_hook", "type-6 direct framebuffer copy"),
    (0x004A4402, "49f0daff", "image_deferred", "deferred image worker"),
    (0x004A87E4, "f5f710f9", "settings_decode_wrapper", "private settings decoder"),
    (0x004A90E4, "d4f790fb", "settings_send_wrapper", "capability response"),
    (0x004AC3EA, "d9f758ff", "faceclaw_send_wear_event", "on-head notification"),
    (0x004AC44E, "d9f726ff", "faceclaw_send_wear_event", "off-head notification"),
    (0x004ED74A, "fef79dfc", "snapshot_complete_2_2_9", "single-fragment snapshot"),
    (0x004EDB42, "fef7a1fa", "snapshot_complete_2_2_9", "multi-fragment snapshot"),
)

IN_PLACE = (
    (0x0048C350, "5ff43432", "5ff43332", "reserve final 1 KiB of primary TLSF arena for CFW state"),
    (0x004EDDD2, "bdf82c10", "40f24120", "image-container width 576"),
    (0x004EDE9A, "bdf82e00", "40f22111", "image-container height 289 sentinel"),
    (0x004EDE9E, "9128", "8842", "image-container height comparison"),
)
EVEN_AI_ENTRY = (0x004F5156, "7fb50600")


def prepare_sources(checkout: Path, destination: Path) -> Path:
    patch_dir = checkout / "patches"
    source_names = (
        "build.py", "patches_main.c", "utils.c", "utils.h", "malloc.c", "malloc.h",
        "draw.c", "draw.h", "cfw_context.c", "cfw_context.h", "rle.c", "rle.h",
        "texture_cache.c", "texture_cache.h", "zlib_glue.c", "settings_ext.c",
        "gesture_fwd.c", "debug.c", "debug.h",
    )
    for name in source_names:
        shutil.copy2(patch_dir / name, destination / name)
    for name in source_names:
        if not name.endswith((".c", ".h")):
            continue
        path = destination / name
        text = path.read_text()
        for old, new in ADDRESS_PROFILE.items():
            if old in text:
                text = checked_replace(text, old, new, name)
        path.write_text(text)

    settings = destination / "settings_ext.c"
    text = settings.read_text()
    text = checked_replace(
        text,
        UPSTREAM_CAPABILITY_MARKER,
        CAPABILITY_MARKER,
        settings.name,
    )
    text = checked_replace(text, '"movw r12, #0x1fd7\\n"', '"movw r12, #0x515b\\n"', settings.name)
    text = checked_replace(text, '"movt r12, #0x004e\\n"', '"movt r12, #0x004f\\n"', settings.name)
    settings.write_text(text)

    zlib_glue = destination / "zlib_glue.c"
    text = zlib_glue.read_text()
    anchor = "typedef int  (*complete_emit_fn)(uint32_t id, void *hdr, int kind, uint32_t p4);"
    text = checked_replace(
        text,
        anchor,
        anchor + "\ntypedef int  (*image_complete_fn)(void *state, uint32_t p1, uint32_t p2, void *p3);",
        zlib_glue.name,
    )
    anchor = "#define FW_COMPLETE_EMIT ((complete_emit_fn)0x004ebd09U)"
    text = checked_replace(
        text,
        anchor,
        anchor + "\n#define FW_IMAGE_COMPLETE ((image_complete_fn)0x004ec089U)",
        zlib_glue.name,
    )
    anchor = """__attribute__((naked)) int snapshot_side(void) {\n    __asm volatile(\n        \"mov r0, r7\\n\\t\"       /* state */\n        \"mov r1, r8\\n\\t\"       /* containerId */\n        \"b   cfw_snapshot\\n\\t\" /* tail-call; resolved intra-.text by build.py */\n    );\n}"""
    wrapper = anchor + """\n\nint snapshot_complete_2_2_9(void *state, uint32_t p1, uint32_t p2, void *p3) {\n    cfw_snapshot((uint8_t *)state, p1);\n    return FW_IMAGE_COMPLETE(state, p1, p2, p3);\n}"""
    text = checked_replace(text, anchor, wrapper, zlib_glue.name)
    zlib_glue.write_text(text)
    return destination / "patches_main.c"


def compile_blob(checkout: Path) -> dict:
    with tempfile.TemporaryDirectory(prefix="sybilsight-g2-2.2.9-") as temporary:
        work = Path(temporary) / "patches"
        work.mkdir(parents=True)
        source = prepare_sources(checkout, work)
        result = subprocess.run(
            ["python3", str(work / "build.py"), str(source), "--json"],
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode:
            raise BuildError(f"g2flash feature compilation failed:\n{result.stderr or result.stdout}")
        return json.loads(result.stdout)


def build(checkout: Path) -> tuple[bytes, dict]:
    base = BASE.read_bytes()
    if sha256(base) != BASE_SHA256:
        raise BuildError("official G2 2.2.9.22 base hash changed")
    commit = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=checkout, check=True,
        capture_output=True, text=True,
    ).stdout.strip()
    if commit != G2FLASH_COMMIT:
        raise BuildError(f"g2flash checkout is {commit}, expected {G2FLASH_COMMIT}")
    recipe_hash = sha256((checkout / "patches" / "cfw_patches.json").read_bytes())
    if recipe_hash != G2FLASH_RECIPE_SHA256:
        raise BuildError("g2flash main patch recipe changed")

    built = compile_blob(checkout)
    blob = bytes.fromhex(built["text"])
    functions = {item["name"]: item["offset"] for item in built["functions"]}
    index, component_offset, payload_start, old_size = find_main_application(base)
    blob_offset = (old_size + 3) & ~3
    blob_address = APP_LOAD_ADDR + blob_offset - APP_PREAMBLE
    programmed_end = blob_address + len(blob)
    if programmed_end > APP_MAX_END:
        raise BuildError(f"injected app ends at {programmed_end:#x}, above {APP_MAX_END:#x}")

    data = bytearray(base)
    operations: list[dict] = []

    def record(offset: int, new: bytes, description: str, expected: bytes | None = None) -> None:
        old = bytes(data[offset : offset + len(new)])
        if expected is not None and old != expected:
            raise BuildError(f"{description} at {offset:#x}: expected {expected.hex()}, got {old.hex()}")
        if old == new:
            return
        operations.append({"offset": offset, "old": old.hex(), "new": new.hex(), "desc": description})
        data[offset : offset + len(new)] = new

    def runtime_offset(address: int) -> int:
        return payload_start + APP_PREAMBLE + address - APP_LOAD_ADDR

    for address, old_hex, function, description in HOOKS:
        target = blob_address + functions[function]
        record(runtime_offset(address), enc_branch(address, target, link=True), description, bytes.fromhex(old_hex))
    for address, old_hex, new_hex, description in IN_PLACE:
        record(runtime_offset(address), bytes.fromhex(new_hex), description, bytes.fromhex(old_hex))
    even_ai_address, even_ai_old = EVEN_AI_ENTRY
    record(
        runtime_offset(even_ai_address),
        enc_branch(even_ai_address, blob_address + functions["faceclaw_evenai_display_entry"], link=False),
        "conditional Even AI entry trampoline",
        bytes.fromhex(even_ai_old),
    )

    old_identity = BASE_VERSION.encode()
    new_identity = OUTPUT_VERSION.encode()
    identity_offsets = []
    cursor = 0
    while True:
        cursor = base.find(old_identity, cursor)
        if cursor < 0:
            break
        identity_offsets.append(cursor)
        cursor += len(old_identity)
    if len(identity_offsets) != 14:
        raise BuildError(f"expected 14 stock runtime/package identities, found {len(identity_offsets)}")
    for offset in identity_offsets:
        record(offset, new_identity, f"package/runtime identity {OUTPUT_VERSION}", old_identity)

    payload_end = payload_start + old_size
    if payload_end != len(data):
        raise BuildError("Apollo main is no longer the final component")
    padding = bytes(blob_offset - old_size)
    append = padding + blob
    operations.append({
        "offset": payload_end, "old": "", "new": append.hex(),
        "desc": "append g2flash main feature blob with the reviewed 2.2.9 address profile",
    })
    data.extend(append)
    new_size = old_size + len(append)
    record(component_offset + 8, struct.pack("<I", new_size), "main-app subheader payload size")
    record(0x40 + index * 16 + 8, struct.pack("<I", new_size + 128), "main-app TOC entry size")
    preamble_word = struct.unpack_from("<I", data, payload_start)[0]
    record(
        payload_start,
        struct.pack("<I", (preamble_word & 0xFF000000) | (new_size & 0xFFFFFF)),
        "main-app preamble length",
    )
    preamble_crc = zlib.crc32(bytes(data[payload_start + 8 : payload_start + new_size])) & 0xFFFFFFFF
    record(payload_start + 4, struct.pack("<I", preamble_crc), "main-app preamble crc32")
    component_crc = crc32c_msb(bytes(data[payload_start : payload_start + new_size]))
    record(0x40 + index * 16 + 12, struct.pack("<I", component_crc), "main-app TOC crc32c")
    record(component_offset + 12, struct.pack("<I", component_crc), "main-app subheader crc32c")

    output = bytes(data)
    replay = bytearray(base)
    for operation in operations:
        offset = operation["offset"]
        old = bytes.fromhex(operation["old"])
        new = bytes.fromhex(operation["new"])
        if old:
            if bytes(replay[offset : offset + len(old)]) != old:
                raise BuildError(f"recipe replay failed at {offset:#x}")
            replay[offset : offset + len(new)] = new
        else:
            if offset != len(replay):
                raise BuildError("recipe append offset changed")
            replay.extend(new)
    if bytes(replay) != output:
        raise BuildError("recipe does not reproduce the output")
    if output.count(new_identity) != 14 or output.count(old_identity) != 0:
        raise BuildError("runtime identity replacement is incomplete")
    if output.count(CAPABILITY_MARKER.encode()) != 1:
        raise BuildError("g2flash capability marker is missing or duplicated")

    profile = {
        "rom_and_ram_symbols": ADDRESS_PROFILE,
        "hooks": [
            {"address": f"0x{address:08x}", "stock_bytes": old, "entry": function, "purpose": purpose}
            for address, old, function, purpose in HOOKS
        ],
        "image_completion_adaptation": "wraps the 2.2.9 four-argument completion routine after taking the FIFO snapshot",
        "gesture_adaptation": "uses the pinned upstream tap-then-long-press forwarding implementation without a 2.2.9-only source rewrite",
        "even_ai_resume": "0x004f515b (Thumb)",
    }
    rebase_patch_sha256 = sha256(json.dumps(profile, sort_keys=True).encode())
    excluded_feature = {
        "id": "ble-advertised-name", "status": "omitted",
        "reason": "Not present on the pinned g2flash main branch and withdrawn after hardware failure evidence.",
    }
    direct_framebuffer_commits = [
        "235a8b304447e330df6a0bce0351e3b6dc3d6f08",
        "28aad42757837db14c08225884a7cc5201e08595",
    ]
    recipe = {
        "schemaVersion": 1,
        "base": BASE.name,
        "base_sha256": BASE_SHA256,
        "base_version": BASE_VERSION,
        "vendor_base_version": BASE_VERSION,
        "release_version": OUTPUT_VERSION,
        "output_version": OUTPUT_VERSION,
        "output": f"g2-{OUTPUT_VERSION}.bin",
        "output_sha256": sha256(output),
        "capability_marker": CAPABILITY_MARKER,
        "g2flash_commit": commit,
        "g2flash_patch_sha256": recipe_hash,
        "g2flash_rebase_patch_sha256": rebase_patch_sha256,
        "excluded_feature": excluded_feature,
        "source_provenance": {
            "g2flash_upstream_commit": commit,
            "g2flash_rebase_patch_sha256": rebase_patch_sha256,
            "excluded_feature": excluded_feature,
            "direct_framebuffer_commits": direct_framebuffer_commits,
            "vendor_base_sha256": BASE_SHA256,
            "address_profile": profile,
            "hardware_validation": "not-yet-hardware-flashed",
            "downstream_contract": {
                "version": 16,
                "change": "Advertises already-present upstream modes 5, 7, 8, and 9 plus ring hold/release forwarding as individually negotiated features.",
                "upstream_marker": UPSTREAM_CAPABILITY_MARKER,
            },
        },
        "patches": operations,
    }
    return output, recipe


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--g2flash", type=Path, default=Path.home() / "Repo" / "g2flash")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    arguments = parser.parse_args()
    output, recipe = build(arguments.g2flash.resolve())
    output_dir = arguments.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    bundle = output_dir / f"g2-{OUTPUT_VERSION}.bin"
    patch_recipe = output_dir / f"cfw_patches-{OUTPUT_VERSION}.json"
    bundle.write_bytes(output)
    patch_recipe.write_text(json.dumps(recipe, indent=2) + "\n")
    print(f"wrote {bundle} ({len(output)} bytes, sha256 {sha256(output)})")
    print(f"wrote {patch_recipe} ({len(recipe['patches'])} operations)")


if __name__ == "__main__":
    main()
