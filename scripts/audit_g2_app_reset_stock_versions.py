#!/usr/bin/env python3
"""Run the fixed product-test reset request through pinned stock Apollo handlers.

This checks native response and deferred reset paths, not live UART delivery
or a physical reset. External delay and reset callees are stubbed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

from capstone import Cs, CS_ARCH_ARM, CS_MODE_THUMB
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_MODE_MCLASS, UC_HOOK_CODE
from unicorn.arm_const import (
    UC_CPU_ARM_CORTEX_M33, UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2,
    UC_ARM_REG_R3, UC_ARM_REG_SP, UC_ARM_REG_LR, UC_ARM_REG_PC,
)

sys.path.insert(0, str(Path(__file__).resolve().parent))
from g2_app_reset_control import RESET_REQUEST, RESET_REPLY_BODY
from g2_pogo_protocol import build_response

RUN_BASE = 0x00438000
HANDLER_PREFIX = bytes.fromhex("1fb5002a06d0002b04d0002802d0c9b20429")
DEFERRED_PREFIX = bytes.fromhex("38b586b014000425002806d0002c04d02900dbb2c9b28b42")
CORE_RESET_PREFIX = bytes.fromhex(
    "bff34f8fdff8c8190a6812f4e062dff8c40902430a60bff34f8f00bffde7"
)
IMAGES = (
    ("2.2.6.10", "36c5b0e499a68ac2493a497bdab9740fd3e7027730c26a9094eca47268a27863", 0x449376, 0x44B0AE),
    ("2.3.2.14", "d6d29ec6a6d7d3f7e0abb260c54493e2e5dd0ed978346dc41061ee6522d40fc6", 0x442A86, 0x44E08A),
    ("2.4.0.24", "33f9eb7a47f996b8bcf34ac9df8bc2f7b698a6512cbf370d25b3215ad0dde298", 0x442AA2, 0x44E42A),
)


def locate_unique(component: bytes, prefix: bytes, label: str, version: str) -> int:
    first = component.find(prefix)
    if first < 32 or component.find(prefix, first + 1) != -1:
        raise ValueError(f"{version}: {label} prefix is not unique")
    return RUN_BASE + first - 32


def inspect_reset_wrapper(component: bytes, wrapper: int, version: str) -> dict[str, object]:
    offset = wrapper - RUN_BASE + 32
    instructions = list(Cs(CS_ARCH_ARM, CS_MODE_THUMB).disasm(component[offset:offset + 8], wrapper))
    if len(instructions) < 3 or [item.mnemonic for item in instructions[:3]] != ["push", "bl", "pop"]:
        raise ValueError(f"{version}: reset wrapper shape differs")
    target = int(instructions[1].op_str.removeprefix("#"), 16)
    target_offset = target - RUN_BASE + 32
    if component[target_offset:target_offset + len(CORE_RESET_PREFIX)] != CORE_RESET_PREFIX:
        raise ValueError(f"{version}: core reset routine differs")
    aircr = int.from_bytes(component[target_offset + 0x9D0:target_offset + 0x9D4], "little")
    key = int.from_bytes(component[target_offset + 0x9D4:target_offset + 0x9D8], "little")
    if (aircr, key) != (0xE000ED0C, 0x05FA0004):
        raise ValueError(f"{version}: AIRCR reset address or key differs")
    return {"coreResetAddress": hex(target), "aircrAddress": hex(aircr), "aircrWriteKey": hex(key)}


def audit_image(path: Path, version: str, expected_sha: str, delay: int, reset: int) -> dict[str, object]:
    component = path.read_bytes()
    digest = hashlib.sha256(component).hexdigest()
    if digest != expected_sha:
        raise ValueError(f"{version}: component hash differs")
    if len(component) < 33 or component[32:32 + 4] == b"\0" * 4:
        raise ValueError(f"{version}: missing Apollo image after component header")
    address = locate_unique(component, HANDLER_PREFIX, "handler", version)
    deferred = locate_unique(component, DEFERRED_PREFIX, "deferred handler", version)
    cpu = Uc(UC_ARCH_ARM, UC_MODE_THUMB | UC_MODE_MCLASS)
    cpu.ctl_set_cpu_model(UC_CPU_ARM_CORTEX_M33)
    cpu.mem_map(0x00400000, 0x400000)
    cpu.mem_write(RUN_BASE, component[32:])
    cpu.mem_map(0x20000000, 0x10000)
    cpu.mem_write(0x20001000, RESET_REQUEST)
    for reg, value in (
        (UC_ARM_REG_R0, 0x20001000),
        (UC_ARM_REG_R1, len(RESET_REQUEST)),
        (UC_ARM_REG_R2, 0x20001100),
        (UC_ARM_REG_R3, 0x20001200),
        (UC_ARM_REG_SP, 0x2000F000),
        (UC_ARM_REG_LR, 0x2000E001),
    ):
        cpu.reg_write(reg, value)
    cpu.emu_start(address | 1, 0x2000E000, count=500)
    length = cpu.mem_read(0x20001200, 1)[0]
    response = bytes(cpu.mem_read(0x20001100, length))
    returned = cpu.reg_read(UC_ARM_REG_R0)
    if returned != 0 or response != RESET_REPLY_BODY:
        raise ValueError(f"{version}: reset response differs")
    framed_response = build_response(0x0B, 0)
    cpu.mem_write(0x20001300, framed_response)
    for reg, value in (
        (UC_ARM_REG_R0, 0x20001000),
        (UC_ARM_REG_R1, len(RESET_REQUEST)),
        (UC_ARM_REG_R2, 0x20001300),
        (UC_ARM_REG_R3, len(framed_response)),
        (UC_ARM_REG_SP, 0x2000F000),
        (UC_ARM_REG_LR, 0x2000E001),
    ):
        cpu.reg_write(reg, value)
    calls: list[tuple[int, int]] = []

    def stop_at_reset(uc: Uc, target: int, _size: int, _unused: object) -> None:
        if target in (delay, reset):
            calls.append((target, uc.reg_read(UC_ARM_REG_R0)))
            if target == reset:
                uc.emu_stop()
            else:
                uc.reg_write(UC_ARM_REG_PC, uc.reg_read(UC_ARM_REG_LR))

    cpu.hook_add(UC_HOOK_CODE, stop_at_reset)
    cpu.emu_start(deferred | 1, 0x2000E000, count=1000)
    if calls != [(delay, 1000), (reset, 1000)]:
        raise ValueError(f"{version}: deferred reset call trace differs")
    reset_core = inspect_reset_wrapper(component, reset, version)
    return {
        "version": version,
        "componentSha256": digest,
        "handlerAddress": hex(address),
        "handlerReturn": returned,
        "deferredHandlerAddress": hex(deferred),
        "deferredCallTrace": [
            {"address": hex(target), "argumentR0": argument}
            for target, argument in calls
        ],
        **reset_core,
        "requestHex": RESET_REQUEST.hex(),
        "responseBodyHex": response.hex(),
        "passed": True,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--open-cfw-root", type=Path, required=True)
    parser.add_argument("--stock-240-component", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("output must be fresh")
    paths = (
        args.open_cfw_root / "g2/blobs/official/g2-2.2.6.10/ota_s200_firmware_ota.bin",
        args.open_cfw_root / "g2/blobs/official/g2-2.3.2.14/ota_s200_firmware_ota.bin",
        args.stock_240_component,
    )
    results = [audit_image(path, version, sha, delay, reset)
               for path, (version, sha, delay, reset) in zip(paths, IMAGES)]
    report = {
        "operation": "pinned-stock-apollo-product-0b-handler-audit",
        "results": results,
        "passed": all(result["passed"] for result in results),
        "proofBoundary": "The three stock application handlers return the fixed acknowledgement; their native deferred handlers reach delay(1000) then a wrapper that calls a routine writing SYSRESETREQ to SCB AIRCR. External delay and reset callees were stubbed. This does not prove live temple delivery, a physical reset, or any bootloader path.",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
