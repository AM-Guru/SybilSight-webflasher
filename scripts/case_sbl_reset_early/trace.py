"""Extract the reviewed stock PB9 sequence by executing the actual case code.

No hardware is opened. GPIO calls and RTOS/busy delays are intercepted; this
proves ordering and arguments, not physical pulse widths or an Apollo reset.
"""
import hashlib
import struct
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_MODE_MCLASS, UC_HOOK_CODE
from unicorn.arm_const import (UC_CPU_ARM_CORTEX_M0, UC_ARM_REG_SP,
    UC_ARM_REG_LR, UC_ARM_REG_PC, UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2)

CASE_SHA256 = "773b6d4cfdaf0a5a74a557e3babe8222a0ae813436b76a7437c1096d2c60d677"


def fnv(data):
    value = 2166136261
    for byte in data:
        value = ((value ^ byte) * 16777619) & 0xffffffff
    return value


def extract(wrapped):
    code = wrapped[32:]
    if hashlib.sha256(code).hexdigest() != CASE_SHA256:
        raise ValueError("reset extraction requires the reviewed complete case code")
    u = Uc(UC_ARCH_ARM, UC_MODE_THUMB | UC_MODE_MCLASS)
    u.ctl_set_cpu_model(UC_CPU_ARM_CORTEX_M0)
    u.mem_map(0x08000000, 0x10000)
    u.mem_write(0x08000000, code)
    u.mem_map(0x20000000, 0x24000)
    actions = []

    def hook(uc, address, size, context):
        value = u.reg_read(UC_ARM_REG_R0)
        if address == 0x08004e9e:
            mask, high = u.reg_read(UC_ARM_REG_R1), u.reg_read(UC_ARM_REG_R2)
            if high not in (0, 1):
                raise ValueError("nonbinary stock GPIO action")
            if (value, mask) == (0x50000000, 8):
                kind = 0
                if high != 1:
                    raise ValueError("unexpected stock gate operation")
            elif (value, mask) == (0x50000400, 512):
                kind = 1
            else:
                raise ValueError("stock reset touches an unreviewed GPIO")
            actions.append((kind, high))
        elif address in (0x0800a7b0, 0x0800a7a2):
            actions.append((2 if address == 0x0800a7b0 else 3, value))
        else:
            if not 0x0800b678 <= address <= 0x0800b7e0:
                raise ValueError(f"unexpected native reset instruction {address:#x}")
            return
        u.reg_write(UC_ARM_REG_PC, u.reg_read(UC_ARM_REG_LR))

    u.hook_add(UC_HOOK_CODE, hook)
    u.reg_write(UC_ARM_REG_SP, 0x20014000)
    u.reg_write(UC_ARM_REG_LR, 0x20010001)
    u.emu_start(0x0800b679, 0x20010000, count=100_000)
    if len(actions) != 103 or actions[0] != (0, 1):
        raise ValueError("unexpected stock reset action count/prefix")
    if struct.unpack_from("<5I", code, 0xd36c) != (512, 1, 0, 3, 0):
        raise ValueError("stock PB9 output descriptor differs")
    encoded = b"".join(struct.pack("<II", *action) for action in actions)
    return {"caseCodeSha256": CASE_SHA256, "nativeEntry": "0x0800b678",
        "actions": actions, "actionFnv": fnv(encoded),
        "nominalDelayTicks": sum(n for kind, n in actions if kind == 2),
        "busyIterations": sum(n for kind, n in actions if kind == 3),
        "physicalTimingMeasured": False, "apolloResetVerified": False}


def header(trace):
    rows = ",\n".join(f" {{{kind}u,{value}u}}" for kind, value in trace["actions"])
    return ("/* Generated from executed stock case code; do not hand edit. */\n"
        f"#define RESET_ACTIONS {len(trace['actions'])}u\n"
        f"#define RESET_FNV {trace['actionFnv']}u\n"
        "static const uint32_t reset_actions[RESET_ACTIONS][2]={\n" + rows + "\n};\n")
