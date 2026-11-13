"""Fail-closed Apollo510 stock writer over an injected Case transport.

There is intentionally no serial or USB implementation here.  A caller must
provide a reviewed transport whose ``transact`` method reaches exactly one
temple through the schema-13 Case bridge.
"""
from __future__ import annotations

import hashlib

from g2_sbl_wire import (
    CASE_BRIDGE_MAX_DATA_BYTES,
    G2_OTA_DESCRIPTOR_ADDRESS,
    MSG_DATA,
    MSG_OTA_DESCRIPTOR,
    MSG_RESET,
    MSG_UPDATE,
    data_frame,
    hello_frame,
    image_segments,
    ota_descriptor_frame,
    parse_ack,
    qualify_stock_update,
    reset_frame,
    update_frame,
)

DEVICE_RISK_TOKEN = "I_ACCEPT_DEVICE_WRITE_RISK"
FIRMWARE_RISK_TOKEN = "I_ACCEPT_FIRMWARE_LANE_RISK"


class SblWriteFailure(RuntimeError):
    def __init__(self, message: str, audit: dict[str, object]):
        super().__init__(message)
        self.audit = audit


def run_stock_update(
    transport,
    image: bytes,
    *,
    expected_image_sha256: str,
    expected_status_frame: bytes,
    expected_route: str,
    device_risk_token: str,
    firmware_risk_token: str,
) -> dict[str, object]:
    """Send one exact stock segment once; never retry an ambiguous command."""
    image = bytes(image)
    expected_status_frame = bytes(expected_status_frame)
    audit: dict[str, object] = {
        "operation": "bounded-apollo510-sbl-stock-update",
        "route": expected_route,
        "imageSha256": hashlib.sha256(image).hexdigest(),
        "statusFrameSha256": hashlib.sha256(expected_status_frame).hexdigest(),
        "descriptorAddress": f"0x{G2_OTA_DESCRIPTOR_ADDRESS:08x}",
        "dataPayloadBytes": CASE_BRIDGE_MAX_DATA_BYTES,
        "commandsAttempted": 0,
        "commandsAcknowledged": 0,
        "dataFramesAttempted": 0,
        "dataFramesAcknowledged": 0,
        "firmwareImageBytesAttempted": 0,
        "firmwareImageBytesAcknowledged": 0,
        "resetAttempted": False,
        "resetAcknowledged": False,
        "retries": 0,
        "glassesRecovered": False,
        "outcome": "not-started",
    }

    def fail(message: str, outcome: str) -> None:
        audit["outcome"] = outcome
        audit["error"] = message
        raise SblWriteFailure(message, audit)

    if expected_route not in ("left", "right"):
        fail("writer route must be left or right", "input-rejected")
    if device_risk_token != DEVICE_RISK_TOKEN or firmware_risk_token != FIRMWARE_RISK_TOKEN:
        fail("both exact operator risk tokens are required", "authorization-rejected")
    if hashlib.sha256(image).hexdigest() != expected_image_sha256.lower():
        fail("stock image SHA-256 differs", "image-rejected")
    try:
        qualification = qualify_stock_update(
            image, expected_status_frame, expected_sha256=expected_image_sha256
        )
        segments = image_segments(image)
    except Exception as error:
        fail(str(error), "qualification-rejected")
    if len(segments) != 1:
        fail("writer permits exactly one stock segment", "image-rejected")
    if not qualification["capacityAccepted"]:
        fail("SBL STATUS advertises insufficient storage", "capacity-rejected")
    audit["qualification"] = qualification
    audit["dataFramesPlanned"] = segments[0]["caseBridgeDataFrames"]

    def transact(frame: bytes, *, label: str, expected_type: int | None = None,
                 sequence: int = 0, timeout: float = 12.0) -> bytes:
        audit["commandsAttempted"] += 1
        try:
            response = transport.transact(frame, timeout=timeout, label=label)
        except Exception as error:
            fail(f"{label} response is ambiguous: {error}", f"{label.lower()}-ambiguous")
        if expected_type is None:
            audit["commandsAcknowledged"] += 1
            return bytes(response)
        try:
            ack = parse_ack(
                bytes(response), expected_message_type=expected_type,
                expected_sequence=sequence,
            )
        except Exception as error:
            fail(f"{label} ACK invalid: {error}", f"{label.lower()}-ack-invalid")
        if not ack["accepted"]:
            fail(
                f"{label} rejected with {ack['statusName']} ({ack['status']})",
                f"{label.lower()}-rejected",
            )
        audit["commandsAcknowledged"] += 1
        return bytes(response)

    status = transact(hello_frame(), label="HELLO")
    if status != expected_status_frame:
        fail("live STATUS differs from the pre-authorized endpoint frame", "status-identity-drift")
    audit["liveStatusMatched"] = True

    transact(
        ota_descriptor_frame(), label="OTADESC",
        expected_type=MSG_OTA_DESCRIPTOR,
    )
    transact(update_frame(image), label="UPDATE", expected_type=MSG_UPDATE)

    for offset in range(0, len(image), CASE_BRIDGE_MAX_DATA_BYTES):
        chunk = image[offset:offset + CASE_BRIDGE_MAX_DATA_BYTES]
        audit["dataFramesAttempted"] += 1
        audit["firmwareImageBytesAttempted"] += len(chunk)
        transact(
            data_frame(offset, chunk), label=f"DATA:{offset}",
            expected_type=MSG_DATA, sequence=offset,
        )
        audit["dataFramesAcknowledged"] += 1
        audit["firmwareImageBytesAcknowledged"] += len(chunk)

    if audit["firmwareImageBytesAcknowledged"] != len(image):
        fail("not every stock-image byte was acknowledged", "data-incomplete")
    audit["resetAttempted"] = True
    transact(reset_frame(), label="RESET", expected_type=MSG_RESET)
    audit["resetAcknowledged"] = True
    audit["outcome"] = "reset-acknowledged-postflight-required"
    return audit


__all__ = [
    "DEVICE_RISK_TOKEN",
    "FIRMWARE_RISK_TOKEN",
    "SblWriteFailure",
    "run_stock_update",
]
