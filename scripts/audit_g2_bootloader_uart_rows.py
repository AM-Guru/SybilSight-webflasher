#!/usr/bin/env python3
"""Decode stock G2 bootloader startup data and inventory its UART rows.

This is a bounded static parser for verified local bootloader components. It
does not connect to the Case or infer which bootloader an individual pair runs.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
from pathlib import Path


RAM_START = 0x20000000
RAM_END = 0x20080000
MAX_DECODED = 1 << 20


def word(data: bytes, offset: int) -> int:
    return struct.unpack_from("<I", data, offset)[0]


def decode_record(image: bytes, record: int) -> bytes:
    """Implement the image's 0x415326 startup expansion with explicit bounds."""
    delta, encoded_length, destination = struct.unpack_from("<iII", image, record)
    if destination != RAM_START or encoded_length & 1:
        raise ValueError("wrong startup record")
    source = record + delta
    end = source + (encoded_length >> 1)
    if not (0 <= source <= end <= len(image)):
        raise ValueError("compressed source outside image")
    out = bytearray()
    cursor = source

    def read_byte() -> int:
        nonlocal cursor
        if cursor >= end:
            raise ValueError("truncated startup record")
        value = image[cursor]
        cursor += 1
        return value

    while cursor < end:
        token = read_byte()
        literal = token & 3
        if literal == 0:
            literal = read_byte() + 3
        match = token >> 4
        if match == 15:
            match = read_byte() + 15
        for _ in range(literal - 1):
            out.append(read_byte())
        if match:
            low = read_byte()
            high = (token >> 2) & 3
            if high == 3:
                high = read_byte()
            distance = low + (high << 8)
            if distance == 0 or distance > len(out):
                raise ValueError("invalid startup backreference")
            for _ in range(match + 2):
                out.append(out[-distance])
                if len(out) > MAX_DECODED:
                    raise ValueError("startup expansion too large")
        if len(out) > MAX_DECODED:
            raise ValueError("startup expansion too large")
    return bytes(out)


def find_initialized_record(image: bytes) -> tuple[int, bytes]:
    matches = []
    for offset in range(0, len(image) - 12, 4):
        if word(image, offset + 8) != RAM_START:
            continue
        delta, length, _ = struct.unpack_from("<iII", image, offset)
        source = offset + delta
        if not (200 < length < 2500 and length % 2 == 0):
            continue
        if not (0 <= source <= source + length // 2 <= len(image)):
            continue
        try:
            decoded = decode_record(image, offset)
        except ValueError:
            continue
        matches.append((offset, decoded))
    if len(matches) != 1:
        raise ValueError(f"expected one initialized-data record, found {len(matches)}")
    return matches[0]


def find_uart_table(decoded: bytes) -> int:
    candidates = []
    for offset in range(0, len(decoded) - 4 * 28 + 1, 4):
        rows = [struct.unpack_from("<7I", decoded, offset + 28 * i) for i in range(4)]
        if [r[0] for r in rows] != [0, 1, 2, 3]:
            continue
        if any(r[2] == 0 or r[3] == 0 or r[4] == 0 for r in rows[1:]):
            continue
        if any(not RAM_START <= r[3] < RAM_END or not RAM_START <= r[4] < RAM_END for r in rows[1:]):
            continue
        candidates.append(offset)
    if len(candidates) != 1:
        raise ValueError(f"expected one UART table, found {len(candidates)}")
    return candidates[0]


def ram_word(decoded: bytes, address: int) -> int:
    offset = address - RAM_START
    if not (0 <= offset <= len(decoded) - 4):
        raise ValueError(f"RAM address {address:#x} outside initialized data")
    return word(decoded, offset)


def rom_words(image: bytes, address: int, count: int) -> list[int]:
    # The OTA bootloader component maps byte zero to Apollo address 0x410000.
    offset = address - 0x410000
    if not (0 <= offset <= len(image) - count * 4):
        raise ValueError(f"ROM address {address:#x} outside component")
    return list(struct.unpack_from("<" + "I" * count, image, offset))


def audit(path: Path) -> dict:
    image = path.read_bytes()
    record, decoded = find_initialized_record(image)
    table_offset = find_uart_table(decoded)
    rows = []
    for index in range(4):
        fields = struct.unpack_from("<7I", decoded, table_offset + 28 * index)
        row = {
            "index": index,
            "kind": fields[0],
            "rom_config": f"0x{fields[2]:08x}",
            "transfer_config": f"0x{fields[3]:08x}",
            "receive_state": f"0x{fields[4]:08x}",
            "startup_callback": f"0x{fields[5]:08x}",
        }
        if index:
            row["rom_config_words"] = rom_words(image, fields[2], 4)
            row["baud"] = ram_word(decoded, fields[3])
            row["receive_state_words"] = [ram_word(decoded, fields[4] + j * 4) for j in range(4)]
            row["startup_receive_count"] = ram_word(decoded, fields[4] + 8)
            row["receive_buffer"] = f"0x{ram_word(decoded, fields[4] + 12):08x}"
        rows.append(row)
    return {
        "source": str(path.resolve()),
        "source_sha256": hashlib.sha256(image).hexdigest(),
        "initialized_record_file_offset": f"0x{record:x}",
        "initialized_data_length": len(decoded),
        "initialized_data_sha256": hashlib.sha256(decoded).hexdigest(),
        "uart_table_ram_address": f"0x{RAM_START + table_offset:08x}",
        "rows": rows,
        "limits": [
            "Startup values alone do not prove that this code executes on the connected glasses.",
            "A zero startup callback does not exclude later runtime registration.",
            "The parser does not establish buffer capacity or physical UART activity.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("components", nargs="+", type=Path)
    args = parser.parse_args()
    print(json.dumps([audit(path) for path in args.components], indent=2))


if __name__ == "__main__":
    main()
