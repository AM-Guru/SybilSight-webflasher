"""Compose SybilSight/230.85 = authenticated .84 + revision-39 keyboard contract.

Offline only. Preserves the entire .84 blob and codec, replays a stock-based recipe,
checks source/stock ABI pins, and refuses any live write outside the reviewed sites.
No firmware is flashed or published. Run test_keyboard_relay before distribution.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import struct
import zlib
from audit_revision35_emitted import thumb_branch_target

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
SOURCE = HERE / "keyboard-relay"
MARKER = "SybilSight/230.85"
PARENT_SHA = "afa6c1da6bc1ba6b0904a438b6acb7f6e628b4fd53c82e1c58d71ba4a431f68b"
PARENT_RECIPE_HASHES = {
    "61e1610f7c506ea08b70b54b86663c11960d661f5c31b362b429c4b5ea1a794a", # archive metadata wrapper
    "b0872d9e10ebcf537f4dc75632b2b0b19b0b7f37acbabc714a6384b3f2fba29a", # original .84 recipe
}
STOCK_SHA = "187ccf2bcc5c17a212106e8a376745511e8289c4232b634a7ea94b9bf25a0979"
DELTA = 0x379BF5
HOOKS = [
    (0x4CAA60, "0ef009fa", "keyboard_dm_alloc_entry", False),
    (0x4CAAB0, "0ef0e1f9", "keyboard_att_alloc_entry", False),
    (0x60093E, "0a681279", "keyboard_io_cap_entry", False),
    (0x601298, "0a681279", "keyboard_io_cap_entry", False),
    (0x4CC1EC, "38b584b0", "keyboard_dispatch_entry", True),
]
SETTINGS_SITE = 1246183 + DELTA
HEAP_SITE = 1986975 + DELTA

def sha(data): return hashlib.sha256(data).hexdigest()

def checked_file(path, expected):
    data = Path(path).read_bytes()
    if sha(data) != expected: raise ValueError(f"Hash changed: {path}")
    return data

def branch(site, target, jump=False):
    displacement = target - (site + 4)
    if displacement & 1 or not -(1 << 24) <= displacement < (1 << 24):
        raise ValueError("Thumb branch out of range")
    imm = displacement & 0x1FFFFFF
    s, i1, i2 = (imm >> 24) & 1, (imm >> 23) & 1, (imm >> 22) & 1
    first = 0xF000 | (s << 10) | ((imm >> 12) & 0x3FF)
    second = (0x9000 if jump else 0xD000) | ((1 ^ i1 ^ s) << 13) | ((1 ^ i2 ^ s) << 11) | ((imm >> 1) & 0x7FF)
    code = struct.pack("<HH", first, second)
    if thumb_branch_target(site, code) != target: raise ValueError("Branch encoding failed")
    return code

def apply_recipe(stock, recipe):
    if sha(stock) != recipe["base_sha256"]: raise ValueError("Recipe donor changed")
    output = bytearray(stock)
    for patch in recipe["patches"]:
        offset = patch["offset"]
        old, new = bytes.fromhex(patch["old"]), bytes.fromhex(patch["new"])
        if not old:
            if offset != len(output): raise ValueError("Append must be at EOF")
        elif output[offset:offset + len(old)] != old:
            raise ValueError(f"Patch preimage mismatch at {offset:#x}")
        output[offset:offset + len(old)] = new
    if sha(output) != recipe["output_sha256"]: raise ValueError("Recipe output changed")
    return bytes(output)

def crc32c(data):
    # EVENOTA uses the MSB-first Castagnoli polynomial, initial zero, no xor-out.
    table = []
    for byte in range(256):
        value = byte << 24
        for _ in range(8): value = ((value << 1) ^ (0x1EDC6F41 if value & 0x80000000 else 0)) & 0xFFFFFFFF
        table.append(value)
    value = 0
    for byte in data: value = ((value << 8) & 0xFFFFFFFF) ^ table[((value >> 24) ^ byte) & 255]
    return value

def components(data):
    rows = []
    for index in range(6):
        toc = 0x40 + index * 16
        _, offset, total, checksum = struct.unpack_from("<IIII", data, toc)
        size = struct.unpack_from("<I", data, offset + 8)[0]
        name = data[offset + 48:offset + 128].split(b"\0")[0].decode()
        payload = data[offset + 128:offset + 128 + size]
        if total != size + 128 or len(payload) != size or crc32c(payload) != checksum:
            raise ValueError("Invalid EVENOTA component: " + name)
        if struct.unpack_from("<I", data, offset + 12)[0] != checksum: raise ValueError("Subheader CRC mismatch")
        rows.append(dict(name=name, payloadBytes=size, payloadSha256=sha(payload), crc32c=f"{checksum:08x}", toc=toc, offset=offset))
    return rows

def validate_sources_and_abi(stock):
    review = json.loads((SOURCE / "review.json").read_text())
    for name, digest in review["source_sha256"].items(): checked_file(SOURCE / "upstream" / name, digest)
    for guard in review["guards"]:
        address = int(guard["address"], 16)
        data = bytes.fromhex(guard["bytes"])
        if stock[address - DELTA:address - DELTA + len(data)] != data:
            raise ValueError("Stock ABI guard failed: " + guard["label"])
    return review

def build(stock_path, parent_path, parent_recipe_path, output_dir):
    stock = checked_file(stock_path, STOCK_SHA)
    parent = checked_file(parent_path, PARENT_SHA)
    recipe_bytes = Path(parent_recipe_path).read_bytes()
    if sha(recipe_bytes) not in PARENT_RECIPE_HASHES: raise ValueError("Parent recipe changed")
    recipe = json.loads(recipe_bytes)
    if apply_recipe(stock, recipe) != parent: raise ValueError("Parent recipe does not reproduce .84")
    review = validate_sources_and_abi(stock)
    previous_components = components(parent)
    main = previous_components[-1]
    if main["name"] != "ota/s200_firmware_ota.bin" or main["offset"] + 128 + main["payloadBytes"] != len(parent):
        raise ValueError("Expected main app to be final component")
    old_blob = next(p for p in recipe["patches"] if not p["old"])
    old_start = old_blob["offset"] + DELTA
    old_end = old_start + len(bytes.fromhex(old_blob["new"]))
    # .84 deliberately carves the sidecar's SRAM out of the stock TLSF arena.
    arena = next(p for p in recipe["patches"] if "TLSF arena" in p["desc"])
    if arena["offset"] != 1130227 or arena["new"] != "5ff43332": raise ValueError("Reserved SRAM contract changed")
    targets = {}
    for site, name in ((SETTINGS_SITE, "PARENT_SETTINGS_DECODE"), (HEAP_SITE, "PARENT_HEAP_RESET")):
        target = thumb_branch_target(site, parent[site - DELTA:site - DELTA + 4])
        if target is None or not old_start <= target < old_end: raise ValueError("Parent hook escaped preserved blob")
        targets[name] = target | 1
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    resolved = out / "source"
    resolved.mkdir(exist_ok=True)
    for p in (SOURCE / "upstream").iterdir():
        if p.is_file(): shutil.copyfile(p, resolved / p.name)
    for name in ("cfw_context.h", "malloc.h", "relay.c"): shutil.copyfile(SOURCE / name, resolved / name)
    (resolved / "parent_hooks.h").write_text("".join(f"#define {name} 0x{target:08x}u\n" for name, target in targets.items()))
    spec = importlib.util.spec_from_file_location("keyboard_compiler", resolved / "build.py")
    compiler = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(compiler)
    compiled = compiler.build_dict(str(resolved / "relay.c"))
    blob = bytes.fromhex(compiled["text"])
    functions = {f["name"]: f["offset"] for f in compiled["functions"]}
    appended_at = ((len(parent) + DELTA + 3) & ~3) - DELTA
    base = appended_at + DELTA
    data = bytearray(parent)
    data.extend(bytes(appended_at - len(data)) + blob)
    extension = []
    def replace(offset, body, description):
        old = bytes(data[offset:offset + len(body)])
        extension.append(dict(offset=offset, old=old.hex(), new=body.hex(), desc=description))
        data[offset:offset + len(body)] = body
    for site, old, name, jump in HOOKS:
        if parent[site - DELTA:site - DELTA + 4] != bytes.fromhex(old): raise ValueError("Keyboard hook preimage changed")
        replace(site - DELTA, branch(site, base + functions[name], jump), name)
    for site, name in ((SETTINGS_SITE, "keyboard_settings_decode"), (HEAP_SITE, "keyboard_heap_startup")):
        replace(site - DELTA, branch(site, base + functions[name]), name)
    old_marker = b"SybilSight/230.84"
    positions = []
    cursor = old_blob["offset"]
    while True:
        cursor = parent.find(old_marker, cursor)
        if cursor < 0: break
        positions.append(cursor)
        replace(cursor, MARKER.encode(), "keyboard-enabled exact identity marker")
        cursor += len(old_marker)
    if len(positions) != 1: raise ValueError("Expected shared settings/direct identity marker")
    payload_start = main["offset"] + 128
    new_size = len(data) - payload_start
    # Stock main-app preamble has a 24-bit payload size and IEEE CRC of bytes after it.
    preamble = payload_start
    size_word = struct.unpack_from("<I", data, preamble)[0]
    replace(preamble, struct.pack("<I", (size_word & 0xFF000000) | new_size), "main-app preamble length")
    replace(preamble + 4, struct.pack("<I", zlib.crc32(data[preamble + 8:])), "main-app preamble CRC32")
    checksum = crc32c(data[payload_start:])
    replace(main["offset"] + 8, struct.pack("<I", new_size), "main-app payload size")
    replace(main["toc"] + 8, struct.pack("<I", new_size + 128), "main-app TOC size")
    replace(main["offset"] + 12, struct.pack("<I", checksum), "main-app subheader CRC32C")
    replace(main["toc"] + 12, struct.pack("<I", checksum), "main-app TOC CRC32C")
    extension.insert(0, dict(offset=len(parent), old="", new=bytes(data[len(parent):]).hex(), desc="append keyboard relay extension"))
    result = dict(recipe)
    result.update(capability_marker=MARKER, output_sha256=sha(data), patches=recipe["patches"] + extension,
        output="g2-2.3.0.24-keyboard-relay-experimental.bin",
        source_provenance=dict(parent_marker="SybilSight/230.84", parent_sha256=PARENT_SHA,
            parent_recipe_sha256=sha(recipe_bytes), keyboard_upstream_commit=review["commit"],
            keyboard_contract=1, source_review="keyboard-relay/review.json"),
        hardware_validation=dict(validated=False, status="offline-built-hardware-unvalidated"))
    if apply_recipe(stock, result) != bytes(data): raise ValueError("Composed recipe replay failed")
    final_components = components(bytes(data))
    if final_components[:-1] != previous_components[:-1]: raise ValueError("Non-main payload changed")
    image = out / "g2-2.3.0.24-keyboard-relay-experimental.bin"
    image.write_bytes(data)
    (out / "keyboard-relay-patches.json").write_text(json.dumps(result, indent=2) + "\n")
    manifest = dict(marker=MARKER, parentMarker="SybilSight/230.84", parentSha256=PARENT_SHA,
        upstreamCommit=review["commit"], keyboardContract=1, image=str(image), imageBytes=len(data),
        outputSha256=sha(data), outputMD5=hashlib.md5(data).hexdigest(), components=final_components,
        injectedBase=base, injectedBytes=len(blob), functions=functions, inheritedTargets=targets,
        hooks=extension[1:8], sourceHashes={p.name: sha(p.read_bytes()) for p in resolved.iterdir() if p.is_file()},
        hardwareValidated=False, status="offline-built-hardware-unvalidated")
    (out / "keyboard-relay-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (out / "compiled.json").write_text(json.dumps(compiled, indent=2) + "\n")
    return manifest

def main():
    archive = ROOT.parent / "SybilSight-webflasher/public/firmware-updates/source-files"
    parent = archive / "2.3.0.24-afa6c1da6bc1"
    if not parent.exists():
        parent = ROOT.parent / "SybilSight-webflasher/work/retired-cfw/2.3.0.24-afa6c1da6bc1"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stock", type=Path, default=archive / "2.3.0.24/1dbdf37b03a1169c384945e94d671371.bin")
    parser.add_argument("--parent", type=Path, default=parent / "g2-2.3.0.24-sybilsight-230.84.bin")
    parser.add_argument("--parent-recipe", type=Path, default=parent / "cfw_patches-230.84.json")
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts/cfw-2.3.0.24/keyboard-relay")
    args = parser.parse_args()
    result = build(args.stock, args.parent, args.parent_recipe, args.output)
    print(json.dumps({k: result[k] for k in ("marker", "image", "imageBytes", "outputSha256", "injectedBytes", "status")}, indent=2))
    return result

if __name__ == "__main__": main()
