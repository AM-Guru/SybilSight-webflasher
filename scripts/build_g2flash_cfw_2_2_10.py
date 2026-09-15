#!/usr/bin/env python3
"""Build a local, untested 2.2.10.x candidate from pinned stock and g2flash.

No download, device access, catalog publication, or Git mutation is performed.
The address profile records the independently reviewed 2.2.9 -> 2.2.10 mapping.
The resulting recipe can be replayed with upstream apply_patches.py without clang.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import struct
import subprocess
import tempfile
import zlib

ROOT = Path(__file__).resolve().parents[1]
PROFILE = ROOT / "scripts/cfw/g2-2.2.10.10-address-profile.json"
STOCK = ROOT / "public/firmware-updates/source-files/2.2.10.10/5d2abaf086ad7cc4709cad679b7b24d1.bin"
PREVIOUS = ROOT / "public/firmware-updates/source-files/2.2.9.22/fc250b05e98a9ff998b4b68f5f99f994.bin"
OUTPUT = ROOT / "work/cfw-2.2.10/candidate"
LOAD = 0x00438000
CEILING = 0x007F0000
MAIN = "ota/s200_firmware_ota.bin"
# g2flash 97301f8 replaced the token list with a numeric revision; the profile pins the exact
# reviewed marker so a contract change upstream fails the build instead of silently shipping.
CAPABILITIES = "Faceclaw/3"


class BuildError(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise BuildError(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def components(image):
    require(image[:8] == b"EVENOTA\0", "Missing EVENOTA header")
    result = {}
    for index in range(struct.unpack_from("<I", image, 8)[0]):
        kind, offset, size, crc = struct.unpack_from("<IIII", image, 64 + index * 16)
        length = struct.unpack_from("<I", image, offset + 8)[0]
        name = image[offset + 48:offset + 128].split(b"\0", 1)[0].decode()
        require(size == length + 128, f"Component size mismatch: {name}")
        result[name] = dict(index=index, kind=kind, offset=offset, start=offset + 128,
                            size=length, crc=crc)
    require(len(result) == 6 and MAIN in result, "Expected six unique components")
    return result


def runtime(image):
    c = components(image)[MAIN]
    return image[c["start"] + 32:c["start"] + c["size"]]


def bytes_at(data, address, length):
    offset = (address & ~1) - LOAD
    require(0 <= offset <= len(data) - length, f"Address outside main: {address:#x}")
    return data[offset:offset + length]


def bl_target(pc, encoded):
    first, second = struct.unpack("<HH", encoded)
    require(first & 0xF800 == 0xF000 and second & 0xD000 == 0xD000,
            f"Expected a Thumb BL at {pc:#x}")
    sign = (first >> 10) & 1
    i1 = 1 ^ ((second >> 13) & 1) ^ sign
    i2 = 1 ^ ((second >> 11) & 1) ^ sign
    offset = ((sign << 24) | (i1 << 23) | (i2 << 22)
              | ((first & 1023) << 12) | ((second & 2047) << 1))
    if sign:
        offset -= 1 << 25
    return pc + 4 + offset


def mapped(profile, address):
    entries = profile["addresses"]
    if hex(address) in entries:
        return int(entries[hex(address)]["new"], 16)
    if address < 0x20000000 and hex(address ^ 1) in entries:
        return int(entries[hex(address ^ 1)]["new"], 16) ^ 1
    raise BuildError(f"No reviewed address mapping for {address:#x}")


def validate_profile(profile, previous, stock):
    require(sha256(previous) == profile["oldBundleSha256"], "Previous stock SHA-256 mismatch")
    require(sha256(stock) == profile["baseBundleSha256"], "2.2.10 stock SHA-256 mismatch")
    old, new = runtime(previous), runtime(stock)
    for text, entry in profile["addresses"].items():
        address, destination = int(text, 16), int(entry["new"], 16)
        for data, location, key in ((old, address, "oldBytes"), (new, destination, "newBytes")):
            if key in entry:
                expected = bytes.fromhex(entry[key])
                require(bytes_at(data, location, len(expected)) == expected,
                        f"Stock signature mismatch: {text} {key}")
        for proof in entry.get("loadEvidence", []):
            for tag, data, value in (("old", old, address), ("new", new, destination)):
                literal = int(proof[tag + "Literal"], 16)
                require(bytes_at(data, literal, 4) == struct.pack("<I", value),
                        f"RAM literal mismatch: {text} {tag}")
                load = int(proof[tag + "Load"], 16)
                require(bytes_at(data, load, 4).hex() == proof[tag + "LoadBytes"],
                        f"RAM load instruction mismatch: {text} {tag}")
    for hook in profile["hooks"]:
        a, b = int(hook["oldAddress"], 16), int(hook["newAddress"], 16)
        require(bytes_at(old, a, len(bytes.fromhex(hook["oldBytes"]))).hex() == hook["oldBytes"],
                f"Old hook mismatch: {hook['symbol']}")
        require(bytes_at(new, b, len(bytes.fromhex(hook["newStockBytes"]))).hex() == hook["newStockBytes"],
                f"New hook mismatch: {hook['symbol']}")
        if "BL_SITE" in hook["symbol"] or hook["symbol"].startswith("GESTURE_") or hook.get("bl") or "blOffset" in hook:
            skip = hook.get("blOffset", 0)
            old_target = bl_target(a + skip, bytes.fromhex(hook["oldBytes"])[skip:skip + 4])
            new_target = bl_target(b + skip, bytes.fromhex(hook["newStockBytes"])[skip:skip + 4])
            require(mapped(profile, old_target) == new_target,
                    f"Hook callee changed unexpectedly: {hook['symbol']}")
    for abi in profile["ringBatteryStockAbi"]:
        require(bytes_at(old, int(abi["oldAddress"], 16), len(abi["oldBytes"]) // 2).hex() == abi["oldBytes"],
                f"Old ring-battery ABI mismatch: {abi['description']}")
        require(bytes_at(new, int(abi["newAddress"], 16), len(abi["newBytes"]) // 2).hex() == abi["newBytes"],
                f"New ring-battery ABI mismatch: {abi['description']}")
    xref = profile["fastIntervalTableReferences"]
    require(old.count(struct.pack("<I", int(xref["oldTableMinus4"], 16))) == xref["count"]
            and new.count(struct.pack("<I", int(xref["newTableMinus4"], 16))) == xref["count"],
            "Fast connection-parameter table reference count changed")
    # Two manually reviewed gesture sites preserve the complete raw record in r6,
    # the event arguments on the stack, and the same dispatcher epilogue.
    require(bytes_at(new, 0x44492A, 6).hex() == "f8b58ab00600", "Gesture frame ABI changed")
    require(bytes_at(new, 0x444AB2, 6).hex() == "05aa08212868", "Press argument ABI changed")
    require(bytes_at(new, 0x444F40, 6).hex() == "06aa4a212868", "Release argument ABI changed")
    require(bytes_at(new, 0x445326, 6).hex() == "00200bb0f0bd", "Gesture epilogue ABI changed")
    # Immediate-ACK target still clears recon-state pending-ACK byte +0x48.
    require(bytes_at(new, 0x4EE9DE, 6).hex() == "002084f84800", "ACK cleanup changed")
    require(0x4EE9A2 + 4 + 0x1C * 2 == 0x4EE9DE, "ACK branch displacement changed")
    require(bytes_at(new, 0x7BB6F8, 6) == b"1.1.4\0", "Stock zlib version changed")
    # Head-up gate: the touch branch still keeps the dispatcher message at [sp, #0xc] and reads
    # its payload pointer from +8, which headup_gate's two-word push turns into [sp, #0x14].
    require(bytes_at(new, 0x45F368, 4).hex() == "03998868", "Head-up message slot ABI changed")
    require(bytes_at(new, 0x45F380, 6).hex() == "072840f0d581", "Touch message-type gate changed")
    # Idle-input gate: r4 = input record ([message+8]) immediately before the replaced BL.
    require(bytes_at(new, 0x45F392, 8).hex() == "0399888003988468", "Idle-input record register ABI changed")
    # Compass emitter: 20-record ring at +8/+12, 0x70-byte stride, flag bit 5 at record+4.
    require(bytes_at(new, 0x4B81C8, 4).hex() == "8868401e", "Compass ring count load changed")
    require(bytes_at(new, 0x4B81D4, 14).hex() == "702202fb00f30b441b7cc3f34013", "Compass ring record layout changed")
    require(bytes_at(new, 0x4B820E, 4).hex() == "21000920", "Compass report arguments changed")
    # Compass decode capture: GAF valid byte +0x4d, fresh-magnetic +0x46, accuracy/anomalies +0x44/+0x45.
    require(bytes_at(new, 0x4B8812, 4).hex() == "98f84d00" and bytes_at(new, 0x4B881C, 4).hex() == "98f84600",
            "GAF output layout changed")
    require(bytes_at(new, 0x4B8830, 4).hex() == "98f84410" and bytes_at(new, 0x4B883A, 4).hex() == "98f84520",
            "GAF magnetic accuracy/anomaly offsets changed")
    require(bytes_at(new, 0x4B87F8, 10).hex() == "434614f1230214f11a01", "GAF decode argument setup changed")
    return len(profile["addresses"])


def capability_marker_emitted(runtime_bytes, functions, marker):
    """True when settings_send_wrapper appends protobuf field 100 = marker.

    Long markers live in .rodata (one contiguous copy). clang inlines
    pb_append_bytes_field for short ones and emits the tag, length and text as
    immediate byte stores, so reconstruct the stored bytes from the function's
    `movs rX,#imm` / `strb rX,[rB,#off]` pairs and compare.
    """
    encoded = marker.encode()
    if runtime_bytes.count(encoded) == 1:
        return True
    import capstone
    wrapper = next((f for f in functions if f["name"] == "settings_send_wrapper"), None)
    if wrapper is None:
        return False
    start = int(wrapper["address"], 16)
    code = runtime_bytes[start - LOAD:start - LOAD + wrapper["size"]]
    cs = capstone.Cs(capstone.CS_ARCH_ARM, capstone.CS_MODE_THUMB)
    cs.detail = True
    registers, stored = {}, {}
    for ins in cs.disasm(code, start):
        ops = ins.operands
        if ins.mnemonic in ("movs", "mov", "mov.w", "movw") and len(ops) == 2 and ops[1].type == capstone.arm.ARM_OP_IMM:
            registers[ops[0].reg] = ops[1].imm & 0xFF
        elif ins.mnemonic == "strb" and len(ops) == 2 and ops[1].type == capstone.arm.ARM_OP_MEM and ops[0].reg in registers:
            stored[ops[1].mem.disp] = registers[ops[0].reg]
        if len(stored) >= len(encoded) + 3 and all(k in stored for k in range(len(encoded) + 3)):
            break
    expected = bytes([0xA2, 0x06, len(encoded)]) + encoded  # field 100, wire type 2
    return bytes(stored.get(i, 0) for i in range(len(expected))) == expected and all(i in stored for i in range(len(expected)))


def import_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def prepare_sources(checkout, destination, profile, overlay=None):
    commit = subprocess.check_output(["git", "-C", str(checkout), "rev-parse", "HEAD"], text=True).strip()
    require(commit == profile["g2flashCommit"], "g2flash checkout is not the reviewed commit")
    originals = {}
    overlays = {}
    for name, digest in profile["sourceSha256"].items():
        data = (checkout / "patches" / name).read_bytes()
        require(sha256(data) == digest, f"g2flash source was modified: {name}")
        # A source overlay replaces a pinned upstream file with a locally reviewed one (for
        # example a seam fix that upstream has not merged). Only pinned names may be
        # replaced, and every replacement digest is recorded in the manifest.
        if overlay is not None and (overlay / name).is_file():
            data = (overlay / name).read_bytes()
            overlays[name] = sha256(data)
        originals[name] = data.decode()
    if overlay is not None:
        stray = sorted(p.name for p in overlay.iterdir() if p.is_file() and p.name not in originals)
        require(not stray, f"overlay contains files that are not pinned sources: {stray}")
    prepare_sources.overlays = overlays
    replacements = {int(a, 16): int(v["new"], 16) for a, v in profile["addresses"].items()}

    def substitute(match):
        address = int(match[0], 16)
        if address in replacements:
            return f"0x{replacements[address]:08x}"
        if LOAD <= address < 0x800000 and address ^ 1 in replacements:
            return f"0x{replacements[address ^ 1] ^ 1:08x}"
        return match[0]

    for name, text in originals.items():
        if name.endswith((".c", ".h")) or name == "patch_compress.py":
            text = re.sub(r"0x[0-9a-fA-F]+", substitute, text)
        # Full addresses in inline MOVW/MOVT pairs are split into halfwords.
        for before, after in profile["trampolineLiterals"].get(name, []):
            require(text.count(before) == 1, f"Missing trampoline literal: {name} {before}")
            text = text.replace(before, after)
        if name.endswith((".c", ".h")):
            # Every remaining ROM/RAM literal must be a reviewed 2.2.10.10 value: an unmapped
            # 2.2.9.22 address left behind would compile into a call/store at the wrong place.
            accepted = {int(v["new"], 16) for v in profile["addresses"].values()}
            accepted |= {v ^ 1 for v in accepted if v < 0x20000000}
            for literal in re.findall(r"0x[0-9a-fA-F]{6,8}", re.sub(r"/\*.*?\*/|//[^\n]*", "", text, flags=re.S)):
                value = int(literal, 16)
                if (LOAD <= value < 0x800000 or 0x20000000 <= value < 0x20800000) and value not in accepted:
                    raise BuildError(f"Unreviewed firmware address {literal} in {name}")
        (destination / name).write_text(text)
    return {p.name: sha256(p.read_bytes()) for p in destination.iterdir() if p.is_file()}


def build(checkout, output_dir, profile, overlay=None, candidate_version=None):
    previous, stock = PREVIOUS.read_bytes(), STOCK.read_bytes()
    count = validate_profile(profile, previous, stock)
    print(f"Validated {count} ROM/RAM/code mappings and all {len(profile['hooks'])} named hooks")
    stock_parts = components(stock)
    main = stock_parts[MAIN]
    with tempfile.TemporaryDirectory(prefix="sybilsight-cfw-2.2.10-") as temporary:
        patch_dir = Path(temporary) / "patches"
        patch_dir.mkdir()
        rebased_hashes = prepare_sources(checkout, patch_dir, profile, overlay)
        source_overlays = getattr(prepare_sources, "overlays", {})
        patcher = import_module(patch_dir / "patch_compress.py", "rebased_g2_patcher")
        patcher.DELTA = LOAD - main["start"] - 32
        def validate_ring_battery_stock(image):
            for abi in profile["ringBatteryStockAbi"]:
                expected = bytes.fromhex(abi["newBytes"])
                offset = patcher.g2f(int(abi["newAddress"], 16))
                require(bytes(image[offset:offset + len(expected)]) == expected,
                        f"ring battery stock ABI mismatch: {abi['description']}")

        patcher.validate_ring_battery_stock = validate_ring_battery_stock
        patcher.TAIL_REF_FALSE_POSITIVES = {
            int(p["address"], 16): p["bytes"] for p in profile["tlsfTailInstructionFalsePositives"]
        }
        compiled = []
        compile_blob = patcher.build_blob

        def retain_blob(source):
            blob = compile_blob(source)
            compiled.append(blob)
            return blob

        patcher.build_blob = retain_blob
        for name in {h["symbol"] for h in profile["hooks"]}:
            hooks = [h for h in profile["hooks"] if h["symbol"] == name]
            current = getattr(patcher, name)
            if isinstance(current, dict):
                tuple_valued = any(isinstance(v, tuple) for v in current.values())
                value = {int(h["newAddress"], 16): ((h["newStockBytes"], h["function"]) if tuple_valued else h["newStockBytes"])
                         for h in hooks}
            else:
                value = (int(hooks[0]["newAddress"], 16), hooks[0]["newStockBytes"])
            setattr(patcher, name, value)
        generated, operations = patcher.build_patch_ops(stock)
        require(len(compiled) == 1, "Expected one compiled feature blob")
        blob_address = LOAD + ((main["size"] + 3) & ~3) - 32
        functions = [{"name": f["name"], "address": hex(blob_address + f["offset"]),
                      "offset": f["offset"], "size": f["size"]}
                     for f in compiled[0]["functions"]]
        data = bytearray(generated)
        old_identity = profile["baseVersion"].encode()
        identity = (candidate_version or profile["candidateVersion"]).encode()
        require(len(old_identity) == len(identity), "Identity replacement must preserve length")
        require(not source_overlays or candidate_version, "A source overlay needs its own candidate version")
        require(stock.count(old_identity) == profile["stockIdentityCount"], "Stock identity count changed")
        cursor = 0
        while (cursor := stock.find(old_identity, cursor)) >= 0:
            require(cursor < 64 or cursor >= main["start"] + 32, "Identity occurs in another component")
            data[cursor:cursor + len(identity)] = identity
            operations.append(dict(offset=cursor, old=old_identity.hex(), new=identity.hex(),
                                   desc="package/runtime identity " + identity.decode()))
            cursor += len(identity)
        final_main = components(data)[MAIN]
        start, end = final_main["start"], final_main["start"] + final_main["size"]
        struct.pack_into("<I", data, start + 4, zlib.crc32(data[start + 8:end]) & 0xFFFFFFFF)
        crc = patcher.crc32c_msb(data[start:end])
        struct.pack_into("<I", data, final_main["offset"] + 12, crc)
        struct.pack_into("<I", data, 64 + final_main["index"] * 16 + 12, crc)
        # Rebind checksum operations to final bytes after changing runtime identities.
        for operation in operations:
            off, size = operation["offset"], len(bytes.fromhex(operation["new"]))
            operation["new"] = bytes(data[off:off + size]).hex()
        replay = import_module(patch_dir / "apply_patches.py", "g2_recipe_replay")
        require(replay.apply_ops(stock, operations) == data, "Recipe replay does not match build")
        require(data.count(old_identity) == 0 and data.count(identity) == profile["stockIdentityCount"],
                "Runtime/package identities are inconsistent")
        require(CAPABILITIES == profile["capabilityMarker"], "Profile capability marker differs from build")
        require(capability_marker_emitted(runtime(data), functions, CAPABILITIES),
                "Upstream capability contract changed")
        require(data.count(b"EVENCFW/") == 0, "Legacy token-based marker still present")
        # The three raw BLE edits must land exactly once each at their reviewed sites.
        for hook in profile["hooks"]:
            if hook.get("patchedBytes"):
                site = int(hook["newAddress"], 16)
                patched = bytes.fromhex(hook["patchedBytes"])
                require(runtime(data)[site - LOAD:site - LOAD + len(patched)] == patched,
                        f"BLE edit missing at {hook['symbol']}")
        for name, component in stock_parts.items():
            if name != MAIN:
                a, size = component["start"], component["size"]
                require(stock[a:a + size] == data[a:a + size], f"Non-main component changed: {name}")
        programmed_end = LOAD + final_main["size"] - 32
        require(programmed_end <= CEILING, "Candidate exceeds reviewed MRAM ceiling")
        output_dir.mkdir(parents=True, exist_ok=True)
        firmware_name = f"g2-{identity.decode()}.bin"
        recipe_name = f"cfw_patches-{identity.decode()}.json"
        recipe = dict(schemaVersion=1, base=STOCK.name, base_version=profile["baseVersion"],
                      base_sha256=sha256(stock), output=firmware_name,
                      output_version=identity.decode(), output_sha256=sha256(data),
                      capability_marker=CAPABILITIES, g2flash_commit=profile["g2flashCommit"],
                      address_profile_sha256=sha256(PROFILE.read_bytes()),
                      hardware_validation="pending-manual-test", patches=operations)
        (output_dir / firmware_name).write_bytes(data)
        (output_dir / recipe_name).write_text(json.dumps(recipe, indent=2) + "\n")
        (output_dir / "ota_s200_firmware_ota.bin").write_bytes(data[start:end])
        (output_dir / PROFILE.name).write_bytes(PROFILE.read_bytes())
        (output_dir / "injected-functions.json").write_text(json.dumps(functions, indent=2) + "\n")
        manifest = dict(version=identity.decode(), baseVersion=profile["baseVersion"],
                        sha256=sha256(data), size=len(data), mainSha256=sha256(data[start:end]),
                        mainBytes=final_main["size"], capabilityMarker=CAPABILITIES,
                        patchCount=len(operations), patchSha256=sha256((output_dir / recipe_name).read_bytes()),
                        g2flashCommit=profile["g2flashCommit"], addressProfileSha256=sha256(PROFILE.read_bytes()),
                        compiler=subprocess.check_output(["clang", "--version"], text=True).splitlines()[0],
                        rebasedSourceSha256=rebased_hashes, programmedEnd=hex(programmed_end),
                        sourceOverlaySha256=source_overlays,
                        sourceOverlayDir=str(overlay) if overlay is not None else None,
                        featureBlobAddress=hex(blob_address), featureBlobBytes=compiled[0]["text_len"],
                        headroomBytes=CEILING - programmed_end, hardwareValidated=False,
                        releaseStatus="local-manual-test-candidate", bleComponentNames=[MAIN])
        (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        paths = sorted(p for p in output_dir.iterdir() if p.is_file() and p.name != "SHA256SUMS")
        (output_dir / "SHA256SUMS").write_text("".join(f"{sha256(p.read_bytes())}  {p.name}\n" for p in paths))
        print(json.dumps(manifest, indent=2))
        return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkout", type=Path, default=Path.home() / "Repo/g2flash")
    parser.add_argument("--output-dir", type=Path, default=OUTPUT)
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--source-overlay", type=Path, default=None,
                        help="directory whose files replace pinned g2flash sources of the same name")
    parser.add_argument("--candidate-version", default=None,
                        help="package/runtime identity for an overlay build (same length as the base version)")
    args = parser.parse_args()
    profile = json.loads(PROFILE.read_text())
    if args.verify_only:
        count = validate_profile(profile, PREVIOUS.read_bytes(), STOCK.read_bytes())
        print(f"Verified {count} mappings against both pinned stock images; hardware test still pending.")
    else:
        build(args.checkout, args.output_dir, profile, args.source_overlay, args.candidate_version)


if __name__ == "__main__":
    main()
