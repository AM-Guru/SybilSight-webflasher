"""Execute the emitted schema-13 request validator in Unicorn."""
from __future__ import annotations

import random
import struct
import zlib

from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB
from unicorn.arm_const import (
    UC_ARM_REG_LR,
    UC_ARM_REG_PC,
    UC_ARM_REG_R0,
    UC_ARM_REG_R1,
    UC_ARM_REG_R3,
    UC_ARM_REG_SP,
)

from g2_sbl_wire import (
    CASE_BRIDGE_MAX_DATA_BYTES,
    data_frame,
    hello_frame,
    ota_descriptor_frame,
    reset_frame,
    update_frame,
)

CODE = 0x20010380
REQUEST = 0x20011000
STACK = 0x2001E000
STOP = 0x2001F000
BAUD_CODE = 0x2001067C
UART = 0x40004800


def execute(payload: bytes, request: bytes) -> int:
    request = bytes(request)
    u = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
    u.mem_map(0x20010000, 0x10000)
    u.mem_write(CODE, payload)
    u.mem_write(REQUEST, request)
    u.reg_write(UC_ARM_REG_R0, REQUEST)
    u.reg_write(UC_ARM_REG_R1, len(request))
    u.reg_write(UC_ARM_REG_SP, STACK)
    u.reg_write(UC_ARM_REG_LR, STOP | 1)
    u.emu_start(CODE | 1, STOP, count=200_000)
    return u.reg_read(UC_ARM_REG_R0)


def _frame(message_type: int, payload: bytes = b"") -> bytes:
    body = struct.pack("<I", ((8 + len(payload)) << 16) | message_type) + payload
    return struct.pack("<I", zlib.crc32(body) & 0xFFFFFFFF) + body


def validate(payload: bytes, stock: bytes):
    stock_bytes = len(stock)
    stock_crc32 = zlib.crc32(stock) & 0xffffffff
    exact = {
        "hello": hello_frame(),
        "descriptor": ota_descriptor_frame(),
        "update": update_frame(stock),
        "reset": reset_frame(),
        "data-first": data_frame(0, stock[:CASE_BRIDGE_MAX_DATA_BYTES]),
        "data-middle": data_frame(997_000, stock[997_000:997_997]),
        "data-last": data_frame(stock_bytes - 995, stock[-995:]),
    }
    for name, request in exact.items():
        if execute(payload, request) != 0:
            raise ValueError(f"schema-13 validator rejected {name}")
        yield {"case": name, "passed": True, "bytes": len(request)}

    for name, request in exact.items():
        for index in range(len(request)):
            corrupt = bytearray(request)
            corrupt[index] ^= 1
            if execute(payload, corrupt) == 0:
                raise ValueError(f"schema-13 validator accepted {name} corruption at {index}")
        yield {"case": f"{name}-all-byte-corruption", "passed": True, "mutations": len(request)}

    rejects = {
        "status-command": _frame(1),
        "abort-command": _frame(4, struct.pack("<I", 0)),
        "recover-command": _frame(5, bytes(40)),
        "ack-command": _frame(7, bytes(12)),
        "wrong-descriptor": _frame(2, struct.pack("<I", 0x004FE000)),
        "wrong-update-size": _frame(3, struct.pack("<III", stock_bytes - 1, stock_crc32, 0)),
        "wrong-update-crc": _frame(3, struct.pack("<III", stock_bytes, stock_crc32 ^ 1, 0)),
        "piggyback-update": _frame(3, struct.pack("<III", stock_bytes, stock_crc32, 1)),
        "por-reset": _frame(6, struct.pack("<I", 2)),
        "empty-data": _frame(8, struct.pack("<I", 0)),
        "past-end-data": data_frame(stock_bytes, b"x"),
        "overrun-data": data_frame(stock_bytes - 1, b"xx"),
        "oversized-host-request": bytes(1010),
    }
    for name, request in rejects.items():
        if execute(payload, request) == 0:
            raise ValueError(f"schema-13 validator accepted {name}")
        yield {"case": name, "passed": True, "bytes": len(request)}

    rng = random.Random(13)
    accepted = 0
    for _ in range(1000):
        size = rng.randrange(0, 1011)
        request = bytes(rng.randrange(256) for _ in range(size))
        accepted += execute(payload, request) == 0
    if accepted:
        raise ValueError(f"schema-13 validator accepted {accepted} random frames")
    yield {"case": "deterministic-random-rejection", "passed": True, "frames": 1000}


def validate_baud_patch(payload: bytes, baud: int):
    brr = 556 if baud == 115_200 else 64
    u = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
    u.mem_map(0x20010000, 0x10000)
    u.mem_map(0x40004000, 0x1000)
    stub = 0x20011000
    u.mem_write(BAUD_CODE, bytes(payload))
    u.mem_write(stub, bytes.fromhex("7047"))
    u.reg_write(UC_ARM_REG_R3, stub | 1)
    u.reg_write(UC_ARM_REG_SP, STACK)
    u.reg_write(UC_ARM_REG_LR, STOP | 1)
    u.emu_start(BAUD_CODE | 1, STOP, count=1000)
    observed = struct.unpack("<I", u.mem_read(UART + 12, 4))[0]
    if observed != brr:
        raise ValueError("schema-13 baud patch did not program the selected BRR")
    return {"case": "temple-uart-baud-patch", "passed": True, "baud": baud, "brr": brr}
