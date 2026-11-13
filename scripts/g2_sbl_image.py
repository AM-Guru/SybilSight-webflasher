"""Offline Ambiq standard-image validation for a prospective G2 SBL recovery.

This module is deliberately separate from the hash-frozen read-only SBL probe
sources. It validates an image envelope but implements no transport or write.
"""
from __future__ import annotations

import hashlib
import struct
import zlib

APOLLO_IMAGE_HEADER_BYTES = 32
APOLLO_IMAGE_MAGIC_NONSECURE = 0xCB
G2_APOLLO_MAIN_LOAD_ADDRESS = 0x00438000
G2_DTCM_START = 0x20000000
G2_DTCM_END = 0x20080000


def parse_apollo_standard_image(data: bytes, *, expected_sha256: str | None = None) -> dict[str, object]:
    """Validate the standard-image envelope without authorizing a device write."""
    if not APOLLO_IMAGE_HEADER_BYTES + 8 <= len(data) <= 0x3FFFFF:
        raise ValueError("Apollo standard image size is outside the 22-bit envelope")
    digest = hashlib.sha256(data).hexdigest()
    if expected_sha256 is not None and digest != expected_sha256.lower():
        raise ValueError("Apollo standard image SHA-256 differs")

    words = struct.unpack_from("<8I", data)
    control, stored_crc, security, reserved, option0, option1, option2, option3 = words
    blob_size = control & 0x3FFFFF
    if blob_size != len(data):
        raise ValueError("Apollo standard image embedded size differs")
    if control & 0x83C00000:
        raise ValueError("Apollo standard image reserved control bits are set")
    if reserved:
        raise ValueError("Apollo standard image reserved common word is nonzero")

    crc_requested = bool(control & (1 << 26))
    calculated_crc = zlib.crc32(data[8:]) & 0xFFFFFFFF
    if crc_requested and stored_crc != calculated_crc:
        raise ValueError("Apollo standard image CRC differs")

    magic = option0 & 0xFF
    load_address = option1 & 0xFFFFFFFC
    initial_sp, reset_vector = struct.unpack_from("<II", data, APOLLO_IMAGE_HEADER_BYTES)
    vector_valid = (
        G2_DTCM_START < initial_sp <= G2_DTCM_END
        and bool(reset_vector & 1)
        and load_address <= (reset_vector & ~1) < load_address + len(data) - APOLLO_IMAGE_HEADER_BYTES
    )
    if magic == APOLLO_IMAGE_MAGIC_NONSECURE and not vector_valid:
        raise ValueError("Apollo nonsecure image vector table is implausible")

    candidate = (
        crc_requested
        and stored_crc == calculated_crc
        and magic == APOLLO_IMAGE_MAGIC_NONSECURE
        and load_address == G2_APOLLO_MAIN_LOAD_ADDRESS
        and vector_valid
    )
    return {
        "bytes": len(data),
        "sha256": digest,
        "blobSize": blob_size,
        "crcRequested": crc_requested,
        "storedCrc32": f"{stored_crc:08x}",
        "calculatedCrc32": f"{calculated_crc:08x}",
        "crcValidated": crc_requested and stored_crc == calculated_crc,
        "authenticationRequested": bool(control & (1 << 28)),
        "encryptionRequested": bool(control & (1 << 27)),
        "certificateChainIncluded": bool(control & (1 << 29)),
        "ambiqOwned": bool(control & (1 << 30)),
        "securityWord": f"{security:08x}",
        "magic": f"{magic:02x}",
        "loadAddress": f"{load_address:08x}",
        "optionWords": [f"{value:08x}" for value in (option0, option1, option2, option3)],
        "initialStackPointer": f"{initial_sp:08x}",
        "resetVector": f"{reset_vector:08x}",
        "vectorValidated": vector_valid,
        "g2StockMainEnvelopeCandidate": candidate,
        "firmwareWriteAuthorized": False,
        "retailPolicyAccepted": None,
        "interpretation": (
            "The bytes form a CRC-valid Ambiq nonsecure standard image at the G2 main address. "
            "Only a live SBL STATUS and a non-writing policy/identity gate can determine whether the retail endpoint may accept it."
            if candidate else
            "The bytes parse as an Ambiq standard image but do not qualify as a CRC-validated G2 main recovery candidate."
        ),
    }
