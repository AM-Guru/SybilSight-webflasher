#!/usr/bin/env python3
"""Execute the pinned stock 2.2.6.10 product 0x0B handler in Unicorn."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from g2_app_reset_control import RESET_REQUEST, RESET_REPLY_BODY
from g2_pogo_flasher import build_package_plan
from g2_pogo_protocol import build_response
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_MODE_MCLASS, UC_HOOK_CODE
from unicorn.arm_const import (
    UC_CPU_ARM_CORTEX_M33, UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2,
    UC_ARM_REG_R3, UC_ARM_REG_SP, UC_ARM_REG_LR, UC_ARM_REG_PC,
)

BUNDLE_SHA256 = "f4dfb0b49ad3de3c2daf17f8a27a157c3dc98411d6a0d3ab2cfd0918f41b9afa"
RUN_BASE = 0x00438000
HANDLER = 0x00572BA0
DEFERRED_HANDLER = 0x0056F92C
DELAY = 0x00449376
SYSTEM_RESET = 0x0044B0AE


def run(bundle: Path) -> dict[str, object]:
    bundle_sha = hashlib.sha256(bundle.read_bytes()).hexdigest()
    if bundle_sha != BUNDLE_SHA256:
        raise ValueError("stock 2.2.6.10 bundle hash differs")
    _plan, main = build_package_plan(bundle)
    image = main.payload[32:]
    cpu = Uc(UC_ARCH_ARM, UC_MODE_THUMB | UC_MODE_MCLASS)
    cpu.ctl_set_cpu_model(UC_CPU_ARM_CORTEX_M33)
    cpu.mem_map(0x00400000, 0x400000)
    cpu.mem_write(RUN_BASE, image)
    cpu.mem_map(0x20000000, 0x10000)
    cpu.mem_write(0x20001000, RESET_REQUEST)
    cpu.reg_write(UC_ARM_REG_R0, 0x20001000)
    cpu.reg_write(UC_ARM_REG_R1, len(RESET_REQUEST))
    cpu.reg_write(UC_ARM_REG_R2, 0x20001100)
    cpu.reg_write(UC_ARM_REG_R3, 0x20001200)
    cpu.reg_write(UC_ARM_REG_SP, 0x2000F000)
    cpu.reg_write(UC_ARM_REG_LR, 0x2000E001)
    cpu.emu_start(HANDLER | 1, 0x2000E000, count=500)
    handler_return = cpu.reg_read(UC_ARM_REG_R0)
    length = cpu.mem_read(0x20001200, 1)[0]
    response = bytes(cpu.mem_read(0x20001100, length))
    framed_response = build_response(0x0B, 0)
    cpu.mem_write(0x20001300, framed_response)
    cpu.reg_write(UC_ARM_REG_R0, 0x20001000)
    cpu.reg_write(UC_ARM_REG_R1, len(RESET_REQUEST))
    cpu.reg_write(UC_ARM_REG_R2, 0x20001300)
    cpu.reg_write(UC_ARM_REG_R3, len(framed_response))
    cpu.reg_write(UC_ARM_REG_SP, 0x2000F000)
    cpu.reg_write(UC_ARM_REG_LR, 0x2000E001)
    calls: list[tuple[int, int]] = []

    def stop_at_reset(uc, address, _size, _unused):
        if address in (DELAY, SYSTEM_RESET):
            calls.append((address, uc.reg_read(UC_ARM_REG_R0)))
            if address == SYSTEM_RESET:
                uc.emu_stop()
            else:
                uc.reg_write(UC_ARM_REG_PC, uc.reg_read(UC_ARM_REG_LR))

    cpu.hook_add(UC_HOOK_CODE, stop_at_reset)
    cpu.emu_start(DEFERRED_HANDLER | 1, 0x2000E000, count=1000)
    expected_calls = [(DELAY, 1000), (SYSTEM_RESET, 1000)]
    result = {
        "operation": "stock-2.2.6.10-native-product-0b-handler-audit",
        "bundleSha256": bundle_sha,
        "mainPayloadSha256": hashlib.sha256(image).hexdigest(),
        "runBase": hex(RUN_BASE),
        "nativeHandler": hex(HANDLER),
        "nativeDeferredHandler": hex(DEFERRED_HANDLER),
        "requestHex": RESET_REQUEST.hex(),
        "handlerReturnValue": handler_return,
        "responseBodyHex": response.hex(),
        "deferredCallTrace": [
            {"address": hex(address), "argumentR0": argument}
            for address, argument in calls
        ],
        "passed": handler_return == 0 and response == RESET_REPLY_BODY and calls == expected_calls,
        "proofBoundary": "Actual stock handler instructions produced the fixed response body; the native deferred handler reached delay(1000) then the system-reset wrapper. Those external callees were stubbed. UART delivery and physical Apollo reset were not executed.",
    }
    if not result["passed"]:
        raise ValueError("native 0x0B handler did not match the reviewed response")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("output must be fresh")
    report = run(args.bundle)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
