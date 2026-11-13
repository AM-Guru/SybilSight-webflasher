"""Offline checks for the passive schema-14 hook and its bounded evidence."""

import struct

from capstone import Cs, CS_ARCH_ARM, CS_MODE_MCLASS, CS_MODE_THUMB

from case_pogo_edge_capture.protocol import (
    EVIDENCE_BYTES,
    RAW_CAPACITY,
    configuration,
    decode,
)
from case_sbl_reset_prepared.trace import fnv
from g2_even_bootlog import APP_DECISION, BOOT_BANNER, OTA_FLAG_PREFIX, UPDATE_DECISION


def evidence(raw, *, total=None, route="left", nonce=0x11223344, status=0, error=0,
             initial_brr=0, pre_edges=(24000, 0, 0, 7), post_edges=(6000, 0, 0, 7)):
    raw = bytes(raw)
    total = len(raw) if total is None else total
    retained = min(total, RAW_CAPACITY)
    if len(raw) != retained:
        raise ValueError("fixture retained length differs")
    words = [0] * 72
    words[:8] = [0x31484E47, 15, status, 5, 0x08009B15 if route == "right" else 0x08009AFF,
                 int(route == "right"), 64, nonce]
    words[8:14] = [0, 0, 2, 2, 1, 1]
    words[14:18] = [0, 12000, 0, 15000]
    words[18:23] = [total, retained, error, 7, 7]
    words[23:27] = [0, 0, 12000, 15000]
    words[27:32] = [0, 7, 63999, 7, 63999]
    words[34:39] = [0, 0, 0, initial_brr, 0]
    words[39:44] = [0, 0, 0, initial_brr, 0]
    words[56:64] = [0x00101008, 0, 0x12, 0x32020802, 0x00101008, 0, 1, 1]
    words[64:68] = pre_edges
    words[68:72] = post_edges
    out = bytearray(EVIDENCE_BYTES)
    struct.pack_into("<72I", out, 0, *words)
    out[288:288 + retained] = raw
    struct.pack_into("<I", out, EVIDENCE_BYTES - 4, fnv(out[:-4]))
    return bytes(out)


def validate(stock, patched, hook, trampoline, source):
    rows = []

    def passed(name, **details):
        rows.append({"case": name, "passed": True, **details})

    if not 0 < len(hook) < 0x1800 or len(hook) % 4:
        raise AssertionError("passive hook storage bounds differ")
    instructions = list(Cs(CS_ARCH_ARM, CS_MODE_THUMB | CS_MODE_MCLASS).disasm(hook, 0x20010000))
    if not instructions or instructions[0].address != 0x20010000:
        raise AssertionError("passive hook does not disassemble at entry")
    passed("compiled-hook-bounds", hookBytes=len(hook), instructions=len(instructions))

    forbidden = ("R(U+40)", "U+0x28")
    if any(token in source for token in forbidden):
        raise AssertionError("passive source gained a temple transmit path")
    if "R(U)=5" not in source or "R(U+24)=8" not in source:
        raise AssertionError("passive RX-only UART setup differs")
    if "R(B+16)>>9" not in source or "PRE_TRANSITIONS" not in source or "POST_TRANSITIONS" not in source:
        raise AssertionError("raw PB9 input sampling differs")
    passed("no-temple-transmit-source", templeBytesSent=0)

    if len(patched) < 0xD9D0 + len(trampoline) or patched[0xD9D0:0xD9D0 + len(trampoline)] != trampoline:
        raise AssertionError("passive trampoline placement differs")
    passed("patched-case-tail", trampolineBytes=len(trampoline))

    for route in ("left", "right"):
        cfg = configuration(route, 0x11223344)
        words = struct.unpack("<8I", cfg)
        if words[2:7] != (15, int(route == "right"), 64, 0x11223344, 15000):
            raise AssertionError("passive configuration differs")
        passed(f"configuration-{route}")

    update = BOOT_BANNER + b"\r\n" + OTA_FLAG_PREFIX + b"55555555\r\n" + UPDATE_DECISION
    result = decode(evidence(update))
    if result["evenBootloaderLog"]["managerDecision"] != "install-staged-image":
        raise AssertionError("update marker fixture differs")
    passed("retained-update-log", retained=result["retainedReceiveBytes"])

    result = decode(evidence(BOOT_BANNER + b"\r\n" + APP_DECISION, route="right"))
    if result["route"] != "right" or result["evenBootloaderLog"]["managerDecision"] != "go-to-app":
        raise AssertionError("application marker fixture differs")
    passed("retained-application-log")

    result = decode(evidence(b""))
    if result["evenBootloaderLog"]["evenBootloaderLogObserved"] or result["templeBytesSent"]:
        raise AssertionError("silence fixture differs")
    passed("silence-is-inconclusive")

    result = decode(evidence(b"", post_edges=(6000, 317, 3000, 7)))
    if not result["rawPb9Observation"]["electricalActivityObserved"]:
        raise AssertionError("raw PB9 transitions were not retained")
    if result["totalReceiveBytes"]:
        raise AssertionError("raw PB9 transitions became UART bytes")
    passed("raw-edges-without-decoded-uart")

    retained = BOOT_BANNER + b"x" * (RAW_CAPACITY - len(BOOT_BANNER))
    result = decode(evidence(retained, total=RAW_CAPACITY + 317))
    if not result["captureOverflowed"] or not result["evenBootloaderLog"]["bootBannerObserved"]:
        raise AssertionError("wrapped marker fixture differs")
    passed("saturated-prefix-retains-early-marker")

    overwritten = b"x" * RAW_CAPACITY
    result = decode(evidence(overwritten, total=RAW_CAPACITY + 317))
    if result["evenBootloaderLog"]["evenBootloaderLogObserved"]:
        raise AssertionError("overwritten marker fixture differs")
    passed("saturated-prefix-excludes-late-marker")

    damaged = bytearray(evidence(update)); damaged[-1] ^= 1
    try:
        decode(bytes(damaged))
    except ValueError:
        passed("evidence-checksum-rejected")
    else:
        raise AssertionError("damaged evidence accepted")
    return rows
