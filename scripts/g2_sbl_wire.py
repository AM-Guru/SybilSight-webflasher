"""Offline Apollo510 SBL wired-update framing for the G2 recovery prototype.

The framing is transcribed from AmbiqSuite 5.2.0's Apollo510
``uart_wired_update.py`` and ``am_defines.py``.  This module deliberately has
no serial transport and does not authorize a write.  It exists so that the
bytes which *would* be sent can be validated before a live endpoint is used.
"""
from __future__ import annotations

import hashlib
import struct
import zlib

from g2_sbl_image import parse_apollo_standard_image
from g2_sbl_protocol import find_status_frames

MSG_HELLO = 0
MSG_STATUS = 1
MSG_OTA_DESCRIPTOR = 2
MSG_UPDATE = 3
MSG_ABORT = 4
MSG_RECOVER = 5
MSG_RESET = 6
MSG_ACK = 7
MSG_DATA = 8

ACK_STATUS_NAMES = {
    0: "success",
    1: "failure",
    2: "invalid-info0",
    3: "crc",
    4: "security",
    5: "message-too-big",
    6: "unknown-message-type",
    7: "invalid-address",
    8: "invalid-operation",
    9: "invalid-parameter",
    10: "sequence",
    11: "too-much-data",
}

MAX_UART_MESSAGE_BYTES = 8192
MAX_DATA_BYTES = MAX_UART_MESSAGE_BYTES - 12
CASE_BRIDGE_MAX_REQUEST_BYTES = 1009
CASE_BRIDGE_MAX_DATA_BYTES = CASE_BRIDGE_MAX_REQUEST_BYTES - 12
MAX_WIRED_IMAGE_HEADER_BYTES = 16 + 384 + 48 + 16
G2_OTA_DESCRIPTOR_ADDRESS = 0x007FE000
G2_MRAM_START = 0x00400000
G2_MRAM_END = 0x00800000


def _frame(message_type: int, payload: bytes = b"") -> bytes:
    """Build the exact CRC-prefixed Apollo wired command."""
    payload = bytes(payload)
    if message_type not in range(MSG_HELLO, MSG_DATA + 1):
        raise ValueError("unknown Apollo wired message type")
    total = 8 + len(payload)
    if total > MAX_UART_MESSAGE_BYTES or total > 0xFFFF:
        raise ValueError("Apollo wired message exceeds the SBL UART buffer")
    body = struct.pack("<I", (total << 16) | message_type) + payload
    return struct.pack("<I", zlib.crc32(body) & 0xFFFFFFFF) + body


def hello_frame() -> bytes:
    return _frame(MSG_HELLO)


def ota_descriptor_frame(address: int = G2_OTA_DESCRIPTOR_ADDRESS) -> bytes:
    if address != G2_OTA_DESCRIPTOR_ADDRESS:
        raise ValueError("G2 prototype permits only the reviewed 0x7FE000 descriptor page")
    if address % 0x2000 or not G2_MRAM_START <= address < G2_MRAM_END:
        raise ValueError("G2 OTA descriptor must be an aligned MRAM page")
    return _frame(MSG_OTA_DESCRIPTOR, struct.pack("<I", address))


def update_frame(segment: bytes) -> bytes:
    segment = bytes(segment)
    if not segment:
        raise ValueError("Apollo UPDATE segment cannot be empty")
    payload = struct.pack("<III", len(segment), zlib.crc32(segment) & 0xFFFFFFFF, 0)
    return _frame(MSG_UPDATE, payload)


def data_frame(offset: int, chunk: bytes) -> bytes:
    chunk = bytes(chunk)
    if not chunk or len(chunk) > MAX_DATA_BYTES:
        raise ValueError("Apollo DATA payload must contain 1..8180 bytes")
    if offset < 0 or offset > 0xFFFFFFFF:
        raise ValueError("Apollo DATA sequence offset is outside uint32")
    return _frame(MSG_DATA, struct.pack("<I", offset) + chunk)


def reset_frame(option: int = 1) -> bytes:
    if option not in (1, 2):
        raise ValueError("Apollo RESET option must be POI (1) or POR (2)")
    return _frame(MSG_RESET, struct.pack("<I", option))


def parse_ack(frame: bytes, *, expected_message_type: int, expected_sequence: int = 0) -> dict[str, object]:
    """Validate one complete SBL ACK, including CRC, echo and sequence."""
    if len(frame) != 20:
        raise ValueError("Apollo ACK must contain exactly 20 bytes")
    crc, header, echoed_type, status, sequence = struct.unpack("<5I", frame)
    if zlib.crc32(frame[4:]) & 0xFFFFFFFF != crc:
        raise ValueError("Apollo ACK CRC differs")
    if header != (20 << 16) | MSG_ACK:
        raise ValueError("Apollo ACK header differs")
    if echoed_type != expected_message_type:
        raise ValueError("Apollo ACK echoed message type differs")
    if sequence != expected_sequence:
        raise ValueError("Apollo ACK sequence differs")
    return {
        "messageType": echoed_type,
        "status": status,
        "statusName": ACK_STATUS_NAMES.get(status, "unknown"),
        "sequence": sequence,
        "accepted": status == 0,
        "frameHex": frame.hex(),
    }


def image_segments(data: bytes) -> list[dict[str, object]]:
    """Parse the Apollo510 host tool's concatenated standard-image segments."""
    data = bytes(data)
    segments = []
    offset = 0
    while offset < len(data):
        if len(data) - offset < 16:
            raise ValueError("truncated Apollo wired image header")
        size = struct.unpack_from("<I", data, offset)[0] & 0x7FFFFF
        if size < 32 or offset + size > len(data):
            raise ValueError("invalid Apollo wired image segment size")
        segment = data[offset:offset + size]
        segments.append({
            "offset": offset,
            "bytes": size,
            "sha256": hashlib.sha256(segment).hexdigest(),
            "crc32": f"{zlib.crc32(segment) & 0xFFFFFFFF:08x}",
            "dataFrames": (size + MAX_DATA_BYTES - 1) // MAX_DATA_BYTES,
            "caseBridgeDataFrames": (size + CASE_BRIDGE_MAX_DATA_BYTES - 1) // CASE_BRIDGE_MAX_DATA_BYTES,
        })
        offset += size
    if not segments:
        raise ValueError("Apollo wired image contains no segments")
    return segments


def qualify_stock_update(data: bytes, status_frame: bytes, *, expected_sha256: str) -> dict[str, object]:
    """Produce a non-executable eligibility report from a real STATUS frame.

    A positive report proves only byte shape, endpoint identity fields and
    advertised storage capacity.  It does not prove that retail policy will
    accept UPDATE and intentionally does not return a transport or send loop.
    """
    frames = find_status_frames(bytes(status_frame))
    if len(frames) != 1 or frames[0]["offset"] != 0 or len(status_frame) != 96:
        raise ValueError("one exact CRC-valid Apollo510 STATUS frame is required")
    image = parse_apollo_standard_image(data, expected_sha256=expected_sha256)
    if not image["g2StockMainEnvelopeCandidate"]:
        raise ValueError("image is not the qualified G2 stock main candidate")
    segments = image_segments(data)
    max_storage = frames[0]["maxStorage"]
    max_update = max_storage + MAX_WIRED_IMAGE_HEADER_BYTES
    capacity_ok = all(row["bytes"] <= max_update for row in segments)
    return {
        "operation": "offline-apollo510-sbl-stock-update-eligibility",
        "sblStatus": frames[0],
        "image": image,
        "segments": segments,
        "maxStorage": max_storage,
        "maxUpdateBytes": max_update,
        "capacityAccepted": capacity_ok,
        "otaDescriptorAddress": f"0x{G2_OTA_DESCRIPTOR_ADDRESS:08x}",
        "vendorDefaultDescriptorRejectedForG2": True,
        "framingValidated": True,
        "retailPolicyAccepted": None,
        "firmwareWriteAuthorized": False,
        "transportExecutionImplemented": False,
        "eligibleForReviewedWriterImplementation": capacity_ok,
    }


__all__ = [
    "ACK_STATUS_NAMES",
    "CASE_BRIDGE_MAX_DATA_BYTES",
    "CASE_BRIDGE_MAX_REQUEST_BYTES",
    "G2_OTA_DESCRIPTOR_ADDRESS",
    "MAX_DATA_BYTES",
    "MSG_ACK",
    "MSG_DATA",
    "MSG_HELLO",
    "MSG_OTA_DESCRIPTOR",
    "MSG_RESET",
    "MSG_UPDATE",
    "data_frame",
    "hello_frame",
    "image_segments",
    "ota_descriptor_frame",
    "parse_ack",
    "qualify_stock_update",
    "reset_frame",
    "update_frame",
]
